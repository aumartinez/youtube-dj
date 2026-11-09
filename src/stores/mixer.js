/**
 * Mixer store — one reactive singleton shared by every component.
 *
 * YouTube player instances are intentionally kept OUTSIDE the reactive state
 * (they are large, stateful iframes and Vue proxies would get in the way).
 * UI state about a deck is reactive; commands go through this module.
 */

import { computed, reactive, watch } from 'vue'
import { loadYouTubeApi } from '../composables/useYouTubeApi'
import {
  DEFAULT_AUTO_FADE,
  hasReachedAutoFadeTrigger,
  normalizeAutoFadeSettings,
} from '../lib/autofade'
import {
  DEFAULT_FADE_DURATION,
  clamp01,
  crossfaderToSide,
  crossfaderVolumes,
  normalizeFadeDuration,
  runFade,
  sideToCrossfader,
} from '../lib/crossfade'
import {
  ITEM_STATES,
  assignItemToDeck,
  countByState,
  createPlaylistItem,
  deckItem,
  findNextQueued,
  markPlayed,
  releaseItem,
  requeuePlayed as requeuePlayedItems,
  reorderItems,
} from '../lib/playlist'
import {
  extractPlaylistId,
  extractVideoId,
  isMixUrl,
  isPlaylistUrl,
  isVideoId,
  oEmbedUrl,
} from '../lib/youtube'
import { loadPersistedState, savePersistedState, serializeState } from '../lib/storage'

const DECK_IDS = ['A', 'B']

const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
}

const ERROR_MESSAGES = {
  2: 'Invalid video parameters — this link cannot be played.',
  5: 'This video cannot play in an HTML5 player.',
  100: 'Video unavailable — it was removed or made private.',
  101: 'The owner does not allow this video to be embedded.',
  150: 'The owner does not allow this video to be embedded.',
}

const otherDeck = (deckId) => (deckId === 'A' ? 'B' : 'A')

function createDeckState(id) {
  const volumes = crossfaderVolumes(id === 'A' ? 0 : 1)
  return {
    id,
    ready: false,
    playing: false,
    buffering: false,
    volume: volumes[id],
    currentTime: 0,
    duration: 0,
    error: '',
  }
}

function createFadeState() {
  return { active: false, progress: 0, source: 'A', target: 'B' }
}

const state = reactive({
  apiStatus: 'idle', // idle | loading | ready | error
  apiError: '',
  items: [],
  decks: {
    A: createDeckState('A'),
    B: createDeckState('B'),
  },
  settings: {
    fadeDuration: DEFAULT_FADE_DURATION,
    autoFade: { ...DEFAULT_AUTO_FADE },
    repeatList: false,
  },
  crossfader: 0,
  activeDeck: 'A',
  fade: createFadeState(),
  // Runtime only, never persisted: which track already fired its cue.
  autoFadeRuntime: { firedFor: null, warnedFor: null },
  importing: { active: false, phase: '', found: 0, added: 0, skipped: 0 },
  blockedDeck: null,
  restored: false,
  notices: [],
})

// --- Non-reactive plumbing -------------------------------------------------

const players = { A: null, B: null }
const containers = { A: null, B: null }
const cuedVideoId = { A: null, B: null }
const playbackChecks = { A: null, B: null }

let fadeHandle = null
let saveTimer = null
let progressTimer = null
let initialized = false
let pagehideBound = false
let noticeSequence = 0
// Nothing is written until init() runs, and tests reset the flag.
let persistSuspended = true

const trackCounts = computed(() => countByState(state.items))

// --- Notices ---------------------------------------------------------------

function notify(message, tone = 'info') {
  noticeSequence += 1
  const notice = { id: noticeSequence, message, tone }
  state.notices.push(notice)
  if (state.notices.length > 4) state.notices.shift()
  setTimeout(() => dismissNotice(notice.id), 6000)
}

function dismissNotice(id) {
  const index = state.notices.findIndex((notice) => notice.id === id)
  if (index >= 0) state.notices.splice(index, 1)
}

// --- Volume ----------------------------------------------------------------

function setPlayerVolume(deckId, volume) {
  try {
    players[deckId]?.setVolume?.(volume)
  } catch {
    // Player replaced/not ready; the next applyVolumes() call catches up.
  }
}

function applyVolumes() {
  const volumes = crossfaderVolumes(state.crossfader)
  state.decks.A.volume = volumes.A
  state.decks.B.volume = volumes.B
  setPlayerVolume('A', volumes.A)
  setPlayerVolume('B', volumes.B)
}

function setCrossfader(value) {
  state.crossfader = clamp01(value)
  applyVolumes()
}

/** Manual fader movement cancels an in-flight fade and re-arms the active deck. */
function moveCrossfader(value) {
  if (state.fade.active) cancelFade(true)
  setCrossfader(value)

  const side = crossfaderToSide(state.crossfader)
  const other = otherDeck(side)
  if (state.decks[side].playing) state.activeDeck = side
  else if (state.decks[other].playing) state.activeDeck = other
}

// --- Player lifecycle ------------------------------------------------------

function ensurePlayer(deckId) {
  if (players[deckId]) return players[deckId]
  if (state.apiStatus !== 'ready') return null

  const element = containers[deckId]
  const YT = typeof window !== 'undefined' ? window.YT : null
  if (!element || !YT?.Player) return null

  try {
    players[deckId] = new YT.Player(element, {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        iv_load_policy: 3,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => handlePlayerReady(deckId, event.target),
        onStateChange: (event) => handlePlayerStateChange(deckId, event.data),
        onError: (event) => handlePlayerError(deckId, event.data),
      },
    })
    return players[deckId]
  } catch (error) {
    state.decks[deckId].error = 'The player could not be created.'
    notify(`Deck ${deckId}: ${error?.message ?? 'player creation failed'}`, 'error')
    return null
  }
}

function handlePlayerReady(deckId, player) {
  if (player) players[deckId] = player
  const deck = state.decks[deckId]
  deck.ready = true
  setPlayerVolume(deckId, deck.volume)

  const item = deckItem(state.items, deckId)
  if (item) cueDeckItem(deckId, item)
  applyVolumes()
}

function handlePlayerStateChange(deckId, status) {
  const deck = state.decks[deckId]

  switch (status) {
    case PLAYER_STATE.PLAYING: {
      deck.playing = true
      deck.buffering = false
      deck.error = ''
      if (state.blockedDeck === deckId) state.blockedDeck = null
      const item = deckItem(state.items, deckId)
      if (item) {
        item.state = ITEM_STATES.PLAYING
        item.error = null
        adoptPlayerTitle(deckId, item)
      }

      // If nothing else is audible, this deck must be heard: a deck that starts
      // playing at volume 0 would look live but sound mute.
      if (!state.fade.active) {
        const other = otherDeck(deckId)
        const volumes = crossfaderVolumes(state.crossfader)
        if (volumes[deckId] === 0 && !state.decks[other].playing) {
          setCrossfader(sideToCrossfader(deckId))
          state.activeDeck = deckId
        }
      }
      break
    }
    case PLAYER_STATE.PAUSED: {
      deck.playing = false
      deck.buffering = false
      const item = deckItem(state.items, deckId)
      if (item && item.state === ITEM_STATES.PLAYING) item.state = ITEM_STATES.LOADED
      break
    }
    case PLAYER_STATE.BUFFERING: {
      deck.buffering = true
      break
    }
    case PLAYER_STATE.CUED:
    case PLAYER_STATE.UNSTARTED: {
      deck.playing = false
      deck.buffering = false
      break
    }
    case PLAYER_STATE.ENDED: {
      handleTrackEnded(deckId)
      break
    }
    default:
      break
  }
}

function handlePlayerError(deckId, code) {
  const message = ERROR_MESSAGES[code] ?? `Playback error (code ${code}).`
  const deck = state.decks[deckId]
  deck.error = message
  deck.playing = false
  deck.buffering = false

  const item = deckItem(state.items, deckId)
  if (item) {
    item.error = message
    if (item.state === ITEM_STATES.PLAYING) item.state = ITEM_STATES.LOADED
  }

  if (state.fade.active) cancelFade(true)
  if (state.blockedDeck === deckId) state.blockedDeck = null
  notify(`Deck ${deckId}: ${message}`, 'error')
}

/** Uses the player's own metadata when oEmbed was unreachable. */
function adoptPlayerTitle(deckId, item) {
  try {
    const data = players[deckId]?.getVideoData?.()
    if (data?.title && item.title.startsWith('YouTube video')) {
      item.title = String(data.title).slice(0, 200)
    }
  } catch {
    // Metadata is a nicety, never a requirement.
  }
}

/** Cues a video without playing it (restore + end-of-track behavior). */
function cueDeckItem(deckId, item) {
  const player = players[deckId]
  if (!player) return
  cuedVideoId[deckId] = item.videoId
  try {
    player.cueVideoById({ videoId: item.videoId })
  } catch {
    // A player that is not ready yet gets cued from onReady instead.
  }
}

function startPlayback(deckId, item) {
  const player = players[deckId]
  if (!player) return
  const deck = state.decks[deckId]
  deck.error = ''

  try {
    if (cuedVideoId[deckId] !== item.videoId) {
      cuedVideoId[deckId] = item.videoId
      player.loadVideoById({ videoId: item.videoId })
    } else {
      player.playVideo()
    }
  } catch (error) {
    deck.error = `Player error: ${error?.message ?? 'unknown'}`
  }

  applyVolumes()
}

/**
 * Browsers can silently refuse a programmatic play(). If the player is still
 * unstarted/cued after a moment, surface the gesture banner instead of lying.
 */
function watchForAutoplayBlock(deckId) {
  clearTimeout(playbackChecks[deckId])
  playbackChecks[deckId] = setTimeout(() => {
    const deck = state.decks[deckId]
    const player = players[deckId]
    if (!player || deck.playing || deck.error) return

    let status = PLAYER_STATE.UNSTARTED
    try {
      status = player.getPlayerState()
    } catch {
      return
    }
    if ([PLAYER_STATE.PLAYING, PLAYER_STATE.BUFFERING, PLAYER_STATE.ENDED].includes(status)) return

    state.blockedDeck = deckId
    notify('Your browser blocked autoplay. Click "Start deck" to allow playback.', 'warn')
  }, 2000)
}

// --- Track ending ----------------------------------------------------------

/**
 * Natural end: retire the finished item, cue the next queued one into the SAME
 * deck without playing it, and never touch the other deck.
 */
function handleTrackEnded(deckId) {
  const deck = state.decks[deckId]
  deck.playing = false
  deck.buffering = false
  deck.currentTime = 0
  cuedVideoId[deckId] = null

  const other = otherDeck(deckId)
  const otherPlaying = state.decks[other].playing

  // A fade that loses one of its decks must land somewhere audible, otherwise
  // the surviving deck keeps playing at volume 0 (the "second track went mute" bug).
  if (state.fade.active && otherPlaying) {
    if (state.fade.source === deckId) {
      // Outgoing track ended before the fade finished: land on the destination.
      cancelFade(true)
      state.fade.progress = 1
      setCrossfader(sideToCrossfader(other))
      state.activeDeck = other
    } else if (state.fade.target === deckId) {
      // Destination died: stay on the source instead of fading into silence.
      cancelFade(true)
      setCrossfader(sideToCrossfader(other))
      state.activeDeck = other
    }
  }

  const finished = deckItem(state.items, deckId)
  if (finished) markPlayed(state.items, finished.id)

  const next = nextQueuedOrRequeued()
  if (next) {
    assignItemToDeck(state.items, next.id, deckId)

    if (otherPlaying) {
      // The other deck is live: prepare this one without stepping on the mix.
      cueDeckItem(deckId, next)
      notify(`Deck ${deckId} finished — "${next.title}" is cued for the mix.`, 'info')
    } else {
      // Nothing else is on air: keep the set going instead of leaving silence.
      cuedVideoId[deckId] = null
      startPlayback(deckId, next)
      watchForAutoplayBlock(deckId)
      state.activeDeck = deckId
      notify(`Deck ${deckId} finished — playing "${next.title}".`, 'info')
    }
  } else {
    notify(`Deck ${deckId} finished. The queue is empty.`, 'info')
  }

  if (state.activeDeck === deckId && state.decks[other].playing) {
    state.activeDeck = other
  }

  // Dead-air guard: the audible deck ended while the other deck was playing
  // silently at the far side of the fader. Continue with the living deck.
  const volumes = crossfaderVolumes(state.crossfader)
  if (!state.fade.active && otherPlaying && volumes[deckId] > 0 && volumes[other] === 0) {
    setCrossfader(sideToCrossfader(other))
    state.activeDeck = other
  }
}

// --- Deck commands ---------------------------------------------------------

/**
 * Next track to play: the first queued item, or — when repeat is on — the whole
 * played history requeued in list order so the list starts over.
 */
function nextQueuedOrRequeued() {
  const next = findNextQueued(state.items)
  if (next) return next
  if (!state.settings.repeatList) return null

  const count = requeuePlayedItems(state.items)
  if (!count) return null

  notify(`Repeat list: ${count} played track${count === 1 ? '' : 's'} requeued.`, 'info')
  return findNextQueued(state.items)
}

function setRepeatList(enabled) {
  state.settings.repeatList = enabled === true
}

/** Manual "start over": puts every consumed track back in the queue. */
function requeuePlayed() {
  const count = requeuePlayedItems(state.items)
  if (count) {
    notify(`Requeued ${count} played track${count === 1 ? '' : 's'}.`, 'success')
  }
  return count
}

function playerReady(deckId) {
  if (state.apiStatus === 'error') {
    notify('The YouTube API is offline. Use Retry in the banner.', 'error')
    return false
  }
  if (state.apiStatus !== 'ready' || !players[deckId] || !state.decks[deckId].ready) {
    notify('The YouTube player is still loading…', 'warn')
    return false
  }
  return true
}

/** Returns the deck's track, taking the next queued item when the deck is empty. */
function ensureDeckItem(deckId) {
  const existing = deckItem(state.items, deckId)
  if (existing && !existing.error) return existing

  if (existing?.error) {
    releaseItem(state.items, existing.id, ITEM_STATES.PLAYED)
    cuedVideoId[deckId] = null
  }

  const next = nextQueuedOrRequeued()
  if (!next) {
    notify('Queue is empty — paste a YouTube link to add a track.', 'warn')
    return null
  }
  return assignItemToDeck(state.items, next.id, deckId)
}

function playDeck(deckId) {
  if (!playerReady(deckId)) return
  const item = ensureDeckItem(deckId)
  if (!item) return

  state.activeDeck = deckId
  startPlayback(deckId, item)
  watchForAutoplayBlock(deckId)
}

function pauseDeck(deckId) {
  if (!playerReady(deckId)) return
  try {
    players[deckId].pauseVideo()
  } catch {
    /* noop */
  }
  state.decks[deckId].playing = false
  const item = deckItem(state.items, deckId)
  if (item?.state === ITEM_STATES.PLAYING) item.state = ITEM_STATES.LOADED
}

/**
 * Stop = reset this deck's playback. The playlist pointer never moves; the
 * track stays attached and is reloaded from zero on the next Play.
 */
function stopDeck(deckId) {
  if (!playerReady(deckId)) return
  try {
    players[deckId].stopVideo()
  } catch {
    /* noop */
  }

  cuedVideoId[deckId] = null
  const deck = state.decks[deckId]
  deck.playing = false
  deck.buffering = false
  deck.currentTime = 0
  deck.duration = 0

  const item = deckItem(state.items, deckId)
  if (item) item.state = ITEM_STATES.LOADED

  // Playback restarts at zero, so the timed cue must be allowed to fire again.
  clearAutoFadeRuntime()

  if (state.activeDeck === deckId) {
    const other = otherDeck(deckId)
    if (state.decks[other].playing) state.activeDeck = other
  }
}

/** Drops an unusable track and cued the next one, without playing it. */
function ejectDeck(deckId) {
  const item = deckItem(state.items, deckId)
  try {
    players[deckId]?.stopVideo?.()
  } catch {
    /* noop */
  }
  cuedVideoId[deckId] = null

  const deck = state.decks[deckId]
  deck.playing = false
  deck.buffering = false
  deck.error = ''

  if (item) markPlayed(state.items, item.id)

  const next = findNextQueued(state.items)
  if (next) {
    assignItemToDeck(state.items, next.id, deckId)
    cueDeckItem(deckId, next)
  }

  clearAutoFadeRuntime()

  if (state.activeDeck === deckId) {
    const other = otherDeck(deckId)
    if (state.decks[other].playing) state.activeDeck = other
  }
}

function resumeFromGesture() {
  const deckId = state.blockedDeck ?? state.activeDeck
  state.blockedDeck = null
  playDeck(deckId)
}

/** Seeks a deck's player to a clamped position in seconds. */
function seekDeck(deckId, seconds) {
  const deck = state.decks[deckId]
  const player = players[deckId]
  if (!player || !deck.ready || !(deck.duration > 0)) return false

  const value = Number(seconds)
  const target = Math.max(0, Math.min(deck.duration, Number.isFinite(value) ? value : 0))
  try {
    player.seekTo(target, true)
  } catch {
    return false
  }
  deck.currentTime = target
  return true
}

/** Cues the first queued track on an idle deck without starting playback. */
function cueNextTrack(deckId) {
  const deck = state.decks[deckId]
  if (deck.playing) {
    notify(`Deck ${deckId} is playing. Stop it before cueing another track.`, 'info')
    return false
  }
  if (deckItem(state.items, deckId)) {
    notify(`Deck ${deckId} already has a track loaded.`, 'info')
    return false
  }

  const next = nextQueuedOrRequeued()
  if (!next) {
    notify('Queue is empty — paste a YouTube link to add a track.', 'warn')
    return false
  }

  assignItemToDeck(state.items, next.id, deckId)
  cuedVideoId[deckId] = null
  cueDeckItem(deckId, next)
  deck.currentTime = 0
  deck.duration = 0
  notify(`"${next.title}" is cued on Deck ${deckId}.`, 'success')
  return true
}

/**
 * Loads a specific playlist track onto a deck, replacing whatever is there.
 * - an unassigned track (queued/played) can go to either deck
 * - a cued (paused) track can move to the other deck
 * - a playing track cannot be stolen; replace or stop it on its own deck first
 * The deck transport is preserved: a playing deck keeps playing the new track.
 */
function loadTrackOnDeck(itemId, deckId) {
  const item = state.items.find((entry) => entry.id === itemId)
  if (!item) return false

  if (item.deck === deckId) {
    notify(`"${item.title}" is already on Deck ${deckId}.`, 'info')
    return false
  }

  if (item.deck) {
    const ownerId = item.deck
    if (state.decks[ownerId].playing) {
      notify(`Deck ${ownerId} is playing "${item.title}" — stop it there first.`, 'warn')
      return false
    }

    releaseItem(state.items, item.id, ITEM_STATES.QUEUED)
    try {
      players[ownerId]?.stopVideo?.()
    } catch {
      /* noop */
    }
    cuedVideoId[ownerId] = null
    state.decks[ownerId].playing = false
    state.decks[ownerId].error = ''
  }

  const deck = state.decks[deckId]
  const previous = deckItem(state.items, deckId)
  const wasPlaying = deck.playing

  if (previous) releaseItem(state.items, previous.id, ITEM_STATES.QUEUED)
  assignItemToDeck(state.items, item.id, deckId)

  cuedVideoId[deckId] = null
  deck.error = ''

  if (wasPlaying) {
    startPlayback(deckId, item)
    watchForAutoplayBlock(deckId)
    state.activeDeck = deckId
    notify(`Deck ${deckId} swapped to "${item.title}" while playing.`, 'success')
  } else {
    cueDeckItem(deckId, item)
    deck.currentTime = 0
    deck.duration = 0
    notify(`"${item.title}" is cued on Deck ${deckId}.`, 'success')
  }

  return true
}

// --- Auto crossfade --------------------------------------------------------

function resolveSourceDeck() {
  const active = state.activeDeck
  const other = otherDeck(active)

  if (state.decks[active].playing) return active
  if (state.decks[other].playing) {
    state.activeDeck = other
    return other
  }
  if (deckItem(state.items, active)) return active
  if (deckItem(state.items, other)) {
    state.activeDeck = other
    return other
  }

  state.activeDeck = crossfaderToSide(state.crossfader)
  return state.activeDeck
}

function waitUntilPlaying(deckIds, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now()

    const tick = () => {
      if (deckIds.every((deckId) => state.decks[deckId].playing)) return resolve(true)
      if (deckIds.some((deckId) => state.decks[deckId].error)) return resolve(false)
      if (!state.fade.active) return resolve(false)
      if (Date.now() - startedAt >= timeoutMs) return resolve(false)
      setTimeout(tick, 120)
    }

    tick()
  })
}

function startFadeAnimation(sourceId, targetId, durationMs) {
  const from = state.crossfader
  const to = sideToCrossfader(targetId)
  state.fade.progress = 0

  fadeHandle = runFade({
    from,
    to,
    durationMs,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    // Hidden tabs stop rAF; the watchdog keeps the fade on schedule.
    watchdogMs: 250,
    setIntervalFn: (callback, ms) => setInterval(callback, ms),
    clearIntervalFn: (id) => clearInterval(id),
    onUpdate: (value, progress) => {
      state.crossfader = value
      state.fade.progress = progress
      applyVolumes()
    },
    onDone: () => {
      fadeHandle = null
      state.fade.active = false
      state.fade.progress = 1
      setCrossfader(to)
      state.activeDeck = targetId
      notify(`Crossfade complete — Deck ${targetId} is live.`, 'success')
    },
  })
}

/**
 * Smart crossfade: direction comes from the active deck, the destination deck
 * is started (and cued if needed) first, then volumes interpolate with rAF.
 */
function autoCrossfade() {
  if (state.fade.active) {
    cancelFade()
    return
  }

  if (state.apiStatus !== 'ready') {
    notify(
      state.apiStatus === 'error'
        ? 'The YouTube API is offline. Use Retry in the banner.'
        : 'The YouTube players are still loading…',
      'warn',
    )
    return
  }

  const sourceId = resolveSourceDeck()
  const targetId = otherDeck(sourceId)

  // Both decks must own a track before any audio starts.
  if (!ensureDeckItem(sourceId)) return
  if (!ensureDeckItem(targetId)) {
    notify('Auto crossfade needs a second track in the queue.', 'warn')
    return
  }

  const sourceItem = deckItem(state.items, sourceId)
  const targetItem = deckItem(state.items, targetId)
  if (!sourceItem || !targetItem) return

  // Snap to the outgoing deck so the fade always has the full travel available.
  setCrossfader(sideToCrossfader(sourceId))
  state.activeDeck = sourceId
  state.fade = { active: true, progress: 0, source: sourceId, target: targetId }

  const durationMs = state.settings.fadeDuration * 1000

  if (!state.decks[sourceId].playing) {
    startPlayback(sourceId, sourceItem)
    watchForAutoplayBlock(sourceId)
  }
  if (!state.decks[targetId].playing) {
    startPlayback(targetId, targetItem)
    watchForAutoplayBlock(targetId)
  }

  waitUntilPlaying([sourceId, targetId], 6000).then((ready) => {
    if (!state.fade.active) return
    if (!ready) {
      state.fade.active = false
      state.fade.progress = 0

      const sourcePlaying = state.decks[sourceId].playing
      // The destination did start but the source is gone: keep the music alive.
      if (!sourcePlaying && state.decks[targetId].playing) {
        setCrossfader(sideToCrossfader(targetId))
        state.activeDeck = targetId
        return
      }

      state.blockedDeck = sourcePlaying ? targetId : sourceId
      notify('Could not start both decks automatically. Press Play on each deck, then fade again.', 'warn')
      return
    }
    startFadeAnimation(sourceId, targetId, durationMs)
  })
}

function cancelFade(silent = false) {
  if (!state.fade.active) return
  fadeHandle?.cancel()
  fadeHandle = null
  state.fade.active = false
  state.fade.progress = 0
  if (!silent) notify('Crossfade cancelled.', 'info')
}

// --- Timed auto fade ("auto DJ") -------------------------------------------

function clearAutoFadeRuntime() {
  state.autoFadeRuntime.firedFor = null
  state.autoFadeRuntime.warnedFor = null
}

function setAutoFade(patch = {}) {
  const next = normalizeAutoFadeSettings({ ...state.settings.autoFade, ...patch })
  state.settings.autoFade = next
  if (!next.enabled) clearAutoFadeRuntime()
}

/** The playing deck that should be faded out; null when neither deck plays. */
function livePlayingDeck() {
  if (state.decks[state.activeDeck].playing) return state.activeDeck
  const other = otherDeck(state.activeDeck)
  return state.decks[other].playing ? other : null
}

/**
 * Called on every player-clock tick. Fires the regular crossfade exactly once
 * per track when its cue point is reached, so the next track starts by itself.
 */
function checkAutoFadeTrigger() {
  const settings = state.settings.autoFade
  if (!settings.enabled) return
  if (state.fade.active) return
  if (state.apiStatus !== 'ready') return

  const deckId = livePlayingDeck()
  if (!deckId) return

  const deck = state.decks[deckId]
  const item = deckItem(state.items, deckId)
  if (!item || item.error) return

  // A different track on the live deck: this one gets its own cue.
  if (state.autoFadeRuntime.firedFor && state.autoFadeRuntime.firedFor !== item.id) {
    state.autoFadeRuntime.firedFor = null
    state.autoFadeRuntime.warnedFor = null
  }
  if (state.autoFadeRuntime.firedFor === item.id) return

  const reached = hasReachedAutoFadeTrigger({
    settings,
    currentTime: deck.currentTime,
    duration: deck.duration,
  })
  if (!reached) return

  const targetId = otherDeck(deckId)
  const nextItem = deckItem(state.items, targetId) ?? nextQueuedOrRequeued()
  if (!nextItem) {
    if (state.autoFadeRuntime.warnedFor !== item.id) {
      state.autoFadeRuntime.warnedFor = item.id
      notify(
        'Timed auto fade reached its cue, but there is no next track. Add one to the queue.',
        'warn',
      )
    }
    return
  }

  state.autoFadeRuntime.firedFor = item.id
  notify(`Timed auto fade on Deck ${deckId} — bringing Deck ${targetId} in.`, 'info')
  autoCrossfade()
}

// --- Playlist --------------------------------------------------------------

// --- Playlist import (public playlists, no API key) -------------------------

let probe = null

function teardownProbe() {
  if (!probe) return
  try {
    probe.player?.destroy?.()
  } catch {
    /* noop */
  }
  try {
    probe.container?.remove?.()
  } catch {
    /* noop */
  }
  probe = null
}

/**
 * Enumerates a public playlist with a throwaway off-screen player:
 * cue the list, then read `getPlaylist()`. The IFrame API requires a viewport
 * of at least 200x200, so the host is real but positioned off-screen.
 */
function collectPlaylistIds(playlistId, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const YT = typeof window !== 'undefined' ? window.YT : null
    if (typeof document === 'undefined' || !YT?.Player) {
      reject(new Error('The YouTube API is not ready.'))
      return
    }

    const container = document.createElement('div')
    container.style.cssText =
      'position:fixed;left:-10000px;top:0;width:320px;height:240px;overflow:hidden;pointer-events:none;'
    document.body.appendChild(container)

    const session = { container, player: null, timer: null, poll: null, done: false }
    probe = session

    const finish = (error, ids) => {
      if (session.done) return
      session.done = true
      clearTimeout(session.timer)
      clearInterval(session.poll)
      if (probe === session) teardownProbe()
      if (error) reject(error)
      else resolve(ids)
    }

    session.timer = setTimeout(
      () => finish(new Error('Timed out while reading that playlist.')),
      timeoutMs + 2000,
    )

    try {
      session.player = new YT.Player(container, {
        width: 320,
        height: 240,
        playerVars: {
          autoplay: 0,
          controls: 0,
          playsinline: 1,
          listType: 'playlist',
          list: playlistId,
        },
        events: {
          onReady: (event) => {
            session.player = event.target
            try {
              event.target.cuePlaylist({ list: playlistId, listType: 'playlist' })
            } catch (error) {
              finish(error)
              return
            }

            let tries = 0
            const check = () => {
              if (session.done) return
              let ids = []
              try {
                ids = event.target.getPlaylist?.() || []
              } catch {
                /* list not parsed yet */
              }
              if (ids.length) {
                finish(null, ids)
                return
              }
              tries += 1
              if (tries > 24) {
                finish(new Error('That playlist returned no public tracks.'))
              }
            }

            session.poll = setInterval(check, 500)
            check()
          },
          onError: () => finish(new Error('YouTube refused to load that playlist.')),
        },
      })
    } catch (error) {
      finish(error)
    }
  })
}

/** Fetches titles for a batch with a small concurrency limit. */
async function fetchTitles(items, limit = 4) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      await fetchTitle(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Imports every track of a public playlist into the shared queue.
 * Deduplicates against the existing queue and never autoplays.
 */
async function importPlaylist(input) {
  if (isMixUrl(input)) {
    return {
      ok: false,
      error:
        'That is an auto-generated YouTube mix. YouTube does not expose its track list — paste a video link or a public playlist (list=PL…).',
    }
  }

  const playlistId = extractPlaylistId(input)
  if (!playlistId) {
    return {
      ok: false,
      error: 'Paste a public YouTube playlist link (youtube.com/playlist?list=…).',
    }
  }
  if (state.importing.active) {
    return { ok: false, error: 'Another playlist import is already running.' }
  }
  if (state.apiStatus !== 'ready') {
    return { ok: false, error: 'The YouTube API is still loading. Try again in a moment.' }
  }

  state.importing = { active: true, phase: 'Reading playlist…', found: 0, added: 0, skipped: 0 }

  try {
    const ids = await collectPlaylistIds(playlistId)
    const seen = new Set(state.items.map((item) => item.videoId))
    const fresh = []

    for (const videoId of ids) {
      if (!isVideoId(videoId) || seen.has(videoId)) {
        state.importing.skipped += 1
        continue
      }
      seen.add(videoId)
      fresh.push(createPlaylistItem({ videoId }))
    }

    state.importing.found = ids.length
    state.importing.added = fresh.length
    state.items.push(...fresh)

    // Same reason as addTrack: keep the reactive proxies, not the raw items.
    const added = state.items.slice(state.items.length - fresh.length)

    if (added.length) {
      state.importing.phase = 'Fetching titles…'
      await fetchTitles(added, 4)
    }

    const skipped = state.importing.skipped
    notify(
      fresh.length
        ? `Imported ${fresh.length} track${fresh.length === 1 ? '' : 's'}${
            skipped ? `, skipped ${skipped} already in the queue` : ''
          }.`
        : 'No new tracks: that playlist is already in the queue.',
      fresh.length ? 'success' : 'info',
    )
    return { ok: true, added: fresh.length, skipped }
  } catch (error) {
    const message = error?.message ?? 'Playlist import failed.'
    notify(`Playlist import failed: ${message}`, 'error')
    return { ok: false, error: message }
  } finally {
    state.importing = { active: false, phase: '', found: 0, added: 0, skipped: 0 }
  }
}

/** Single entry point for the add field: video URL or playlist URL. */
function submitUrl(input) {
  if (isPlaylistUrl(input)) return importPlaylist(input)
  return addTrack(input)
}

async function fetchTitle(item) {
  if (typeof fetch !== 'function') return
  try {
    const response = await fetch(oEmbedUrl(item.videoId))
    if (!response.ok) return
    const data = await response.json()
    if (data?.title && item.title.startsWith('YouTube video')) {
      item.title = String(data.title).slice(0, 200)
    }
  } catch {
    // Offline or CORS-blocked: the fallback title and the player metadata remain.
  }
}

function addTrack(input) {
  const videoId = extractVideoId(input)
  if (!videoId) {
    return {
      ok: false,
      error: isMixUrl(input)
        ? 'That is an auto-generated YouTube mix. YouTube does not expose its track list — paste a video link or a public playlist (list=PL…).'
        : 'Paste a valid YouTube link (watch, youtu.be, shorts or embed) or a bare video id.',
    }
  }

  const mix = isMixUrl(input)

  const duplicate = state.items.find(
    (item) => item.videoId === videoId && item.state !== ITEM_STATES.PLAYED,
  )
  if (duplicate) {
    return { ok: false, error: 'That video is already in the queue.' }
  }

  const item = createPlaylistItem({ videoId })
  state.items.push(item)
  // `item` is the raw object; mutate the reactive proxy so the row re-renders.
  const stored = state.items[state.items.length - 1]
  void fetchTitle(stored)

  if (mix) {
    return {
      ok: true,
      item: stored,
      warning:
        'YouTube does not expose auto-generated mix/radio track lists. Added just that video — copy the other videos individually, or use a public playlist (list=PL…).',
    }
  }

  return { ok: true, item: stored }
}

function removeTrack(itemId) {
  const index = state.items.findIndex((item) => item.id === itemId)
  if (index === -1) return false

  const item = state.items[index]
  if (item.deck) {
    const deckId = item.deck
    try {
      players[deckId]?.stopVideo?.()
    } catch {
      /* noop */
    }
    cuedVideoId[deckId] = null

    const deck = state.decks[deckId]
    deck.playing = false
    deck.buffering = false
    deck.error = ''

    if (state.activeDeck === deckId) {
      const other = otherDeck(deckId)
      if (state.decks[other].playing) state.activeDeck = other
    }
  }

  state.items.splice(index, 1)
  return true
}

/** Drag-and-drop reorder. Deck ownership lives on items, so playback is untouched. */
function moveTrack(fromIndex, toIndex) {
  return reorderItems(state.items, fromIndex, toIndex)
}

function clearPlayed() {
  for (let index = state.items.length - 1; index >= 0; index -= 1) {
    if (state.items[index].state === ITEM_STATES.PLAYED) state.items.splice(index, 1)
  }
}

function setFadeDuration(value) {
  state.settings.fadeDuration = normalizeFadeDuration(value)
}

// --- Persistence -----------------------------------------------------------

function persistNow() {
  if (persistSuspended) return
  savePersistedState(
    serializeState({
      items: state.items,
      settings: state.settings,
      crossfader: state.crossfader,
    }),
  )
}

function schedulePersist() {
  // Mid-fade positions are transient; the fade end saves the final value.
  if (state.fade.active) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistNow()
  }, 400)
}

watch(
  () => [
    state.items,
    state.settings.fadeDuration,
    state.settings.autoFade,
    state.settings.repeatList,
    state.crossfader,
  ],
  () => schedulePersist(),
  { deep: true },
)

// --- Bootstrap -------------------------------------------------------------

function cueAssignedDecks() {
  for (const deckId of DECK_IDS) {
    const item = deckItem(state.items, deckId)
    if (item) cueDeckItem(deckId, item)
  }
}

function startProgressLoop() {
  if (progressTimer) return
  progressTimer = setInterval(() => {
    for (const deckId of DECK_IDS) {
      const player = players[deckId]
      if (!player) continue
      try {
        const current = player.getCurrentTime?.()
        const duration = player.getDuration?.()
        if (Number.isFinite(current)) state.decks[deckId].currentTime = current
        if (Number.isFinite(duration)) state.decks[deckId].duration = duration
      } catch {
        // Not ready yet.
      }
    }
    checkAutoFadeTrigger()
  }, 250)
}

async function bootstrapApi() {
  state.apiStatus = 'loading'
  state.apiError = ''

  try {
    await loadYouTubeApi()
  } catch (error) {
    state.apiStatus = 'error'
    state.apiError = error?.message ?? 'Unknown error while loading the YouTube API.'
    return false
  }

  state.apiStatus = 'ready'
  for (const deckId of DECK_IDS) ensurePlayer(deckId)
  cueAssignedDecks()
  applyVolumes()
  return true
}

async function init() {
  if (initialized) return
  initialized = true
  persistSuspended = false

  const restored = loadPersistedState()
  if (restored) {
    state.items.push(...restored.items)
    state.settings.fadeDuration = restored.settings.fadeDuration
    state.settings.autoFade = restored.settings.autoFade
    state.settings.repeatList = restored.settings.repeatList === true
    state.crossfader = restored.crossfader
    state.activeDeck = crossfaderToSide(restored.crossfader)
    state.restored = restored.items.length > 0
  }

  applyVolumes()

  if (typeof window !== 'undefined' && !pagehideBound) {
    pagehideBound = true
    window.addEventListener('pagehide', persistNow)
  }

  await bootstrapApi()
  startProgressLoop()

  if (state.restored) {
    notify('Session restored — tracks are cued but silent. Press Play to resume.', 'info')
  }
}

async function retryApi() {
  if (state.apiStatus === 'loading') return
  for (const deckId of DECK_IDS) {
    players[deckId] = null
    state.decks[deckId].ready = false
    state.decks[deckId].error = ''
  }
  await bootstrapApi()
  startProgressLoop()
}

function attachDeckContainer(deckId, element) {
  const changed = containers[deckId] !== element
  containers[deckId] = element

  // A remount (HMR) gives us a fresh host: drop the stale iframe-bound player.
  if (changed && players[deckId]) {
    try {
      players[deckId].destroy?.()
    } catch {
      /* noop */
    }
    players[deckId] = null
    cuedVideoId[deckId] = null
    state.decks[deckId].ready = false
    state.decks[deckId].playing = false
  }

  if (state.apiStatus === 'ready') ensurePlayer(deckId)

  const item = deckItem(state.items, deckId)
  if (item && players[deckId] && state.decks[deckId].ready && cuedVideoId[deckId] !== item.videoId) {
    cueDeckItem(deckId, item)
  }
}

function detachDeckContainer(deckId) {
  containers[deckId] = null
}

/** Full reset used by tests (and safe for a future remount flow). */
export function resetMixerForTests() {
  persistSuspended = true
  teardownProbe()
  fadeHandle?.cancel()
  fadeHandle = null
  clearTimeout(saveTimer)
  saveTimer = null
  clearInterval(progressTimer)
  progressTimer = null
  clearTimeout(playbackChecks.A)
  clearTimeout(playbackChecks.B)
  playbackChecks.A = null
  playbackChecks.B = null

  players.A = null
  players.B = null
  cuedVideoId.A = null
  cuedVideoId.B = null
  containers.A = null
  containers.B = null

  initialized = false
  state.apiStatus = 'idle'
  state.apiError = ''
  state.items.splice(0, state.items.length)
  state.decks.A = createDeckState('A')
  state.decks.B = createDeckState('B')
  state.settings.fadeDuration = DEFAULT_FADE_DURATION
  state.settings.autoFade = { ...DEFAULT_AUTO_FADE }
  state.settings.repeatList = false
  state.autoFadeRuntime = { firedFor: null, warnedFor: null }
  state.importing = { active: false, phase: '', found: 0, added: 0, skipped: 0 }
  state.crossfader = 0
  state.activeDeck = 'A'
  state.fade = createFadeState()
  state.blockedDeck = null
  state.restored = false
  state.notices.splice(0, state.notices.length)
}

export const mixer = {
  state,
  trackCounts,
  init,
  retryApi,
  attachDeckContainer,
  detachDeckContainer,
  playDeck,
  pauseDeck,
  stopDeck,
  seekDeck,
  ejectDeck,
  resumeFromGesture,
  cueNextTrack,
  loadTrackOnDeck,
  autoCrossfade,
  cancelFade: () => cancelFade(),
  moveCrossfader,
  setFadeDuration,
  setAutoFade,
  setRepeatList,
  requeuePlayed,
  addTrack,
  importPlaylist,
  submitUrl,
  removeTrack,
  moveTrack,
  clearPlayed,
  dismissNotice,
  deckItem: (deckId) => deckItem(state.items, deckId),
  resetMixerForTests,
}

export function useMixer() {
  return mixer
}
