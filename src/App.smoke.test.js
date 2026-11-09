// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { resetMixerForTests, useMixer } from './stores/mixer'

const mixer = useMixer()

/** Minimal YT.Player stand-in: synchronous state transitions, no network. */
class FakePlayer {
  static instances = []
  static playlistIds = []

  constructor(element, options) {
    this.element = element
    this.options = options
    this.status = -1
    this.volume = 100
    this.videoId = null
    this.currentTime = 0
    this.duration = 0
    this.seekToCalls = []
    this.events = options.events ?? {}
    FakePlayer.instances.push(this)
    queueMicrotask(() => this.events.onReady?.({ target: this }))
  }

  setVolume(value) {
    this.volume = value
  }

  cueVideoById({ videoId }) {
    this.videoId = videoId
    this.transition(5)
  }

  loadVideoById({ videoId }) {
    this.videoId = videoId
    this.transition(1)
  }

  playVideo() {
    this.transition(1)
  }

  pauseVideo() {
    this.transition(2)
  }

  stopVideo() {
    this.transition(-1)
  }

  getPlayerState() {
    return this.status
  }

  getCurrentTime() {
    return this.currentTime
  }

  getDuration() {
    return this.duration
  }

  seekTo(seconds) {
    this.currentTime = seconds
    this.seekToCalls.push(seconds)
  }

  getVideoData() {
    return { title: 'Fake video title' }
  }

  cuePlaylist() {
    this.playlist = FakePlayer.playlistIds
  }

  getPlaylist() {
    return this.playlist ?? []
  }

  destroy() {
    this.destroyed = true
  }

  transition(status) {
    this.status = status
    this.events.onStateChange?.({ data: status, target: this })
  }

  end() {
    this.transition(0)
  }
}

function stubYouTube() {
  window.YT = {
    Player: FakePlayer,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  }
}

let wrappers = []

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await flushPromises()
  return wrapper
}

function deck(wrapper, id) {
  return wrapper.find(`.deck--${id.toLowerCase()}`)
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((entry) => entry.text().startsWith(label))
}

async function click(wrapper, label) {
  const target = button(wrapper, label)
  expect(target, `button "${label}" should exist`).toBeTruthy()
  await target.trigger('click')
  await flushPromises()
}

async function addTrack(wrapper, url) {
  await wrapper.find('.playlist__input').setValue(url)
  await wrapper.find('.playlist__form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  FakePlayer.instances = []
  FakePlayer.playlistIds = []
  stubYouTube()

  // Deterministic fade start: the rAF stub records the launch but never ticks.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline test'))))

  resetMixerForTests()
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('App shell', () => {
  it('renders both decks, the mixer and the playlist', async () => {
    const wrapper = await mountApp()

    expect(wrapper.find('.deck--a').exists()).toBe(true)
    expect(wrapper.find('.deck--b').exists()).toBe(true)
    expect(wrapper.find('.mixer-panel').exists()).toBe(true)
    expect(wrapper.find('.playlist').exists()).toBe(true)
    expect(deck(wrapper, 'A').text()).toContain('Deck A')
    expect(deck(wrapper, 'B').text()).toContain('Deck B')

    // The direction lives in the strip below the button, not duplicated in it.
    expect(button(wrapper, 'Auto crossfade').text().trim()).toBe('Auto crossfade')
    expect(wrapper.find('.direction').text()).toContain('A → B')
  })

  it('creates one real player per deck once the API is ready', async () => {
    await mountApp()
    expect(FakePlayer.instances).toHaveLength(2)
    expect(mixer.state.decks.A.ready).toBe(true)
    expect(mixer.state.decks.B.ready).toBe(true)
  })
})

describe('playlist', () => {
  it('adds a YouTube URL and rejects a non-YouTube one', async () => {
    const wrapper = await mountApp()

    await addTrack(wrapper, 'https://vimeo.com/12345')
    expect(wrapper.text()).toContain('Paste a valid YouTube link')
    expect(wrapper.findAll('.track')).toHaveLength(0)

    await addTrack(wrapper, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')
    expect(wrapper.findAll('.track')).toHaveLength(1)
    expect(wrapper.find('.track__title').text()).toContain('YouTube video dQw4w9WgXcQ')
    expect(wrapper.text()).not.toContain('Paste a valid YouTube link')
  })

  it('refuses to add the same video twice', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/dQw4w9WgXcQ')
    await addTrack(wrapper, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(wrapper.findAll('.track')).toHaveLength(1)
    expect(wrapper.text()).toContain('already in the queue')
  })

  it('does not advance the playlist when a deck is stopped', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    expect(mixer.state.decks.A.playing).toBe(true)
    expect(mixer.state.items[0].state).toBe('playing')
    expect(wrapper.find('.track--playing').exists()).toBe(true)

    await click(deck(wrapper, 'A'), 'Stop')
    expect(mixer.state.decks.A.playing).toBe(false)
    expect(mixer.state.items[0].state).toBe('loaded')
    expect(mixer.state.items[1].state).toBe('queued')
    expect(wrapper.findAll('.track')).toHaveLength(2)
    expect(wrapper.find('.track--playing').exists()).toBe(false)
  })
})

describe('playlist import', () => {
  async function submitUrl(wrapper, value) {
    await wrapper.find('.playlist__input').setValue(value)
    await wrapper.find('.playlist__form').trigger('submit')
    await flushPromises()
  }

  it('imports a public playlist, skips duplicates and tears the probe player down', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')

    FakePlayer.playlistIds = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']
    await submitUrl(wrapper, 'https://www.youtube.com/playlist?list=PL1234567890')
    await new Promise((resolve) => setTimeout(resolve, 120))
    await flushPromises()

    expect(mixer.state.items.map((item) => item.videoId)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
      'ccccccccccc',
    ])
    expect(wrapper.findAll('.track')).toHaveLength(3)

    const probe = FakePlayer.instances[FakePlayer.instances.length - 1]
    expect(probe.destroyed).toBe(true)
  })

  it('applies fetched titles without needing another interaction', async () => {
    const wrapper = await mountApp()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ title: 'Fetched title' }) })),
    )

    FakePlayer.playlistIds = ['bbbbbbbbbbb']
    await submitUrl(wrapper, 'https://www.youtube.com/playlist?list=PL1234567890')
    await new Promise((resolve) => setTimeout(resolve, 120))
    await flushPromises()

    expect(wrapper.find('.track__title').text()).toBe('Fetched title')
  })

  it('adds only the seed video for a mix url and explains why', async () => {
    const wrapper = await mountApp()
    await submitUrl(
      wrapper,
      'https://www.youtube.com/watch?v=o7lC8JAWWEA&list=RDo7lC8JAWWEA&start_radio=1',
    )

    expect(mixer.state.items).toHaveLength(1)
    expect(mixer.state.items[0].videoId).toBe('o7lC8JAWWEA')
    expect(wrapper.find('.playlist__warning').exists()).toBe(true)
    expect(wrapper.find('.playlist__warning').text()).toContain('does not expose')
  })

  it('rejects a mix url that has no video to fall back to', async () => {
    const wrapper = await mountApp()
    await submitUrl(wrapper, 'https://www.youtube.com/playlist?list=RDo7lC8JAWWEA')

    expect(wrapper.text()).toContain('auto-generated YouTube mix')
    expect(wrapper.findAll('.track')).toHaveLength(0)
  })

  it('rejects a playlist link without a list id', async () => {
    const wrapper = await mountApp()
    await submitUrl(wrapper, 'https://www.youtube.com/playlist')

    expect(wrapper.text()).toContain('public YouTube playlist')
    expect(wrapper.findAll('.track')).toHaveLength(0)
  })
})

describe('loading a specific track', () => {
  it('points an empty first-run deck at the add field', async () => {
    const wrapper = await mountApp()
    expect(deck(wrapper, 'A').text()).toContain('Add a track to start')

    await click(deck(wrapper, 'A'), 'Add a track to start')
    expect(document.activeElement).toBe(wrapper.find('.playlist__input').element)
  })

  it('cues the first queued track from an empty deck without playing it', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')

    await click(deck(wrapper, 'A'), 'Cue next track')

    expect(mixer.state.items[0].deck).toBe('A')
    expect(mixer.state.items[0].state).toBe('loaded')
    expect(mixer.state.decks.A.playing).toBe(false)
    expect(FakePlayer.instances[0].videoId).toBe('aaaaaaaaaaa')
    expect(deck(wrapper, 'A').text()).not.toContain('Cue next track')
  })

  it('replaces a playing deck track and keeps the deck playing', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await click(deck(wrapper, 'A'), 'Play')
    expect(mixer.state.items[0].state).toBe('playing')

    const secondRow = wrapper.findAll('.track')[1]
    await secondRow.find('.track__load--a').trigger('click')
    await flushPromises()

    expect(mixer.state.items[0].state).toBe('queued')
    expect(mixer.state.items[1].deck).toBe('A')
    expect(mixer.state.items[1].state).toBe('playing')
    expect(mixer.state.decks.A.playing).toBe(true)
    expect(FakePlayer.instances[0].videoId).toBe('bbbbbbbbbbb')
    expect(wrapper.text()).toContain('swapped')
  })

  it('moves a cued track to the other deck without starting it', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await click(deck(wrapper, 'A'), 'Play')
    await click(deck(wrapper, 'A'), 'Stop')

    expect(mixer.state.items[0].deck).toBe('A')
    expect(mixer.state.items[0].state).toBe('loaded')

    await wrapper.findAll('.track')[0].find('.track__load--b').trigger('click')
    await flushPromises()

    expect(mixer.state.items[0].deck).toBe('B')
    expect(mixer.state.items[0].state).toBe('loaded')
    expect(mixer.state.decks.A.playing).toBe(false)
    expect(mixer.state.decks.B.playing).toBe(false)
    expect(FakePlayer.instances[1].videoId).toBe('aaaaaaaaaaa')
  })

  it('refuses to steal a track that is playing on the other deck', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await click(deck(wrapper, 'A'), 'Play')

    const row = wrapper.findAll('.track')[0]
    const loadOnB = row.find('.track__load--b')
    expect(loadOnB.attributes('disabled')).toBeDefined()

    await loadOnB.trigger('click')
    await flushPromises()

    expect(mixer.state.items[0].deck).toBe('A')
    expect(mixer.state.decks.B.playing).toBe(false)
  })
})

describe('crossfade', () => {
  it('starts the destination deck and assigns both decks from the queue', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    await click(wrapper, 'Auto crossfade')
    await flushPromises()

    expect(mixer.state.fade.active).toBe(true)
    expect(mixer.state.fade.source).toBe('A')
    expect(mixer.state.fade.target).toBe('B')
    expect(mixer.state.decks.A.playing).toBe(true)
    expect(mixer.state.decks.B.playing).toBe(true)
    expect(mixer.state.items.filter((item) => item.deck).length).toBe(2)
    expect(mixer.state.crossfader).toBe(0)
  })

  it('reports a missing second track instead of starting a fake fade', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await click(deck(wrapper, 'A'), 'Play')

    await click(wrapper, 'Auto crossfade')
    expect(mixer.state.fade.active).toBe(false)
    expect(wrapper.text()).toContain('needs a second track')
  })

  it('lands on the destination when the outgoing track ends mid-fade', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await click(deck(wrapper, 'A'), 'Play')
    await click(wrapper, 'Auto crossfade')
    await flushPromises()

    expect(FakePlayer.instances[1].volume).toBe(0)

    FakePlayer.instances[0].end()
    await flushPromises()

    expect(mixer.state.crossfader).toBe(1)
    expect(mixer.state.decks.B.volume).toBe(100)
    expect(FakePlayer.instances[1].volume).toBe(100)
    expect(mixer.state.activeDeck).toBe('B')
  })

  it('keeps the source audible when the destination dies mid-fade', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await click(deck(wrapper, 'A'), 'Play')
    await click(wrapper, 'Auto crossfade')
    await flushPromises()

    FakePlayer.instances[1].end()
    await flushPromises()

    expect(mixer.state.crossfader).toBe(0)
    expect(FakePlayer.instances[0].volume).toBe(100)
    expect(mixer.state.decks.A.playing).toBe(true)
  })

  it('finishes a fade even when no animation frame arrives (background tab)', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    mixer.setFadeDuration(4)
    await click(deck(wrapper, 'A'), 'Play')
    await click(wrapper, 'Auto crossfade')
    expect(mixer.state.fade.active).toBe(true)

    // The global rAF stub never calls back, like a hidden tab. Only the
    // time-based watchdog can complete the fade.
    await new Promise((resolve) => setTimeout(resolve, 5000))
    await flushPromises()

    expect(mixer.state.fade.active).toBe(false)
    expect(mixer.state.crossfader).toBe(1)
    expect(mixer.state.decks.B.volume).toBe(100)
    expect(FakePlayer.instances[1].volume).toBe(100)
  }, 15000)

  it('seeks a deck within bounds', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await click(deck(wrapper, 'A'), 'Play')
    const player = FakePlayer.instances[0]
    player.duration = 100
    mixer.state.decks.A.duration = 100

    expect(mixer.seekDeck('A', 42)).toBe(true)
    expect(player.seekToCalls.at(-1)).toBe(42)
    expect(mixer.state.decks.A.currentTime).toBe(42)

    mixer.seekDeck('A', 999)
    expect(player.seekToCalls.at(-1)).toBe(100)

    mixer.seekDeck('A', -5)
    expect(player.seekToCalls.at(-1)).toBe(0)
  })

  it('seeks from the progress bar by pointer and keyboard', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await click(deck(wrapper, 'A'), 'Play')
    const player = FakePlayer.instances[0]
    player.duration = 100
    mixer.state.decks.A.duration = 100
    mixer.state.decks.A.currentTime = 10

    const bar = deck(wrapper, 'A').find('.deck__progress')
    Object.defineProperty(bar.element, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 200, top: 0, height: 8, right: 200, bottom: 8 }),
    })

    bar.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    await flushPromises()
    bar.element.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, bubbles: true }))
    await flushPromises()

    expect(player.seekToCalls.at(-1)).toBeCloseTo(50, 1)

    await bar.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(player.seekToCalls.at(-1)).toBeCloseTo(55, 1)
  })

  it('never leaves the only playing deck at zero volume', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')

    mixer.moveCrossfader(1)
    await click(deck(wrapper, 'A'), 'Play')
    await flushPromises()

    expect(mixer.state.decks.A.volume).toBe(100)
    expect(FakePlayer.instances[0].volume).toBe(100)
  })

  it('shows the crossfade direction with an arrow that flips', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    const direction = wrapper.find('.direction')
    expect(direction.exists()).toBe(true)
    expect(direction.text()).toContain('A → B')
    expect(direction.find('.fa-arrow-right-long').exists()).toBe(true)

    await click(deck(wrapper, 'B'), 'Play')
    await flushPromises()
    expect(wrapper.find('.direction').text()).toContain('B → A')
    expect(wrapper.find('.direction .fa-arrow-left-long').exists()).toBe(true)
  })
})

describe('timed auto fade', () => {
  async function armBeforeEnd(wrapper, secondsBeforeEnd = 4) {
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await click(deck(wrapper, 'A'), 'Play')
    mixer.setAutoFade({ enabled: true, mode: 'before-end', secondsBeforeEnd })
  }

  it('starts the next deck when the cue point is reached', async () => {
    const wrapper = await mountApp()
    await armBeforeEnd(wrapper)

    const playerA = FakePlayer.instances[0]
    playerA.duration = 100
    playerA.currentTime = 90

    await new Promise((resolve) => setTimeout(resolve, 700))
    await flushPromises()
    expect(mixer.state.fade.active).toBe(false)

    playerA.currentTime = 96.2
    await new Promise((resolve) => setTimeout(resolve, 700))
    await flushPromises()

    expect(mixer.state.fade.active).toBe(true)
    expect(mixer.state.decks.B.playing).toBe(true)
    expect(mixer.state.fade.source).toBe('A')
    expect(mixer.state.autoFadeRuntime.firedFor).toBe(mixer.state.items[0].id)
  })

  it('does nothing while the toggle is off', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await click(deck(wrapper, 'A'), 'Play')

    const playerA = FakePlayer.instances[0]
    playerA.duration = 100
    playerA.currentTime = 99

    mixer.setAutoFade({ enabled: false, mode: 'before-end', secondsBeforeEnd: 4 })
    await new Promise((resolve) => setTimeout(resolve, 700))
    await flushPromises()

    expect(mixer.state.fade.active).toBe(false)
    expect(mixer.state.decks.B.playing).toBe(false)
  })
})

describe('repeat list', () => {
  async function endDeck(playerIndex = 0) {
    FakePlayer.instances[playerIndex].end()
    await flushPromises()
  }

  it('toggles repeat from the playlist header', async () => {
    const wrapper = await mountApp()
    const toggle = wrapper.findAll('button').find((button) => button.text().includes('Repeat list'))
    expect(toggle).toBeTruthy()

    await toggle.trigger('click')
    expect(mixer.state.settings.repeatList).toBe(true)

    await toggle.trigger('click')
    expect(mixer.state.settings.repeatList).toBe(false)
  })

  it('keeps rotating decks when repeat is on', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    mixer.setRepeatList(true)

    await click(deck(wrapper, 'A'), 'Play')
    await endDeck(0)

    expect(mixer.state.items[1].deck).toBe('B')
    expect(mixer.state.items[1].state).toBe('playing')
    expect(mixer.state.items[0].deck).toBe('A')
    expect(mixer.state.items[0].state).toBe('loaded')

    await endDeck(1)

    expect(mixer.state.items[0].deck).toBe('A')
    expect(mixer.state.items[0].state).toBe('playing')
    expect(mixer.state.items[1].deck).toBe('B')
    expect(mixer.state.items[1].state).toBe('loaded')
    expect(mixer.state.decks.A.playing).toBe(true)
  })

  it('leaves the list exhausted when repeat is off', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    await endDeck(0)
    expect(mixer.state.items[1].deck).toBe('B')

    await endDeck(1)

    expect(mixer.state.items.every((item) => item.state === 'played')).toBe(true)
    expect(mixer.deckItem('A')).toBeNull()
    expect(mixer.deckItem('B')).toBeNull()
  })

  it('requeues every played track from the header button', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    await endDeck(0)
    await endDeck(1)
    expect(wrapper.findAll('.track--played')).toHaveLength(2)

    const requeue = wrapper.findAll('button').find((button) => button.text().includes('Requeue played'))
    expect(requeue).toBeTruthy()
    await requeue.trigger('click')
    await flushPromises()

    expect(mixer.state.items.every((item) => item.state === 'queued')).toBe(true)
    expect(wrapper.findAll('.track--played')).toHaveLength(0)
  })
})

describe('natural end', () => {
  it('hands the next queued item to the other deck when the only playing deck ends', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    FakePlayer.instances[0].end()
    await flushPromises()

    expect(mixer.state.items[0].state).toBe('played')
    expect(mixer.state.items[1].state).toBe('playing')
    expect(mixer.state.items[1].deck).toBe('B')
    expect(mixer.state.decks.B.playing).toBe(true)
    expect(FakePlayer.instances[1].videoId).toBe('bbbbbbbbbbb')
    expect(mixer.deckItem('A')).toBeNull()
  })

  it('preloads the following track into the deck that finished', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await addTrack(wrapper, 'https://youtu.be/ccccccccccc')

    await click(deck(wrapper, 'A'), 'Play')
    FakePlayer.instances[0].end()
    await flushPromises()

    expect(mixer.state.items[1].deck).toBe('B')
    expect(mixer.state.items[1].state).toBe('playing')
    expect(mixer.state.items[2].deck).toBe('A')
    expect(mixer.state.items[2].state).toBe('loaded')
    expect(FakePlayer.instances[0].videoId).toBe('ccccccccccc')
  })

  it('keeps the other deck playing when a track ends', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')
    await addTrack(wrapper, 'https://youtu.be/ccccccccccc')

    await click(deck(wrapper, 'A'), 'Play')
    await click(deck(wrapper, 'B'), 'Play')
    expect(mixer.state.decks.B.playing).toBe(true)

    FakePlayer.instances[0].end()
    await flushPromises()

    expect(mixer.state.decks.B.playing).toBe(true)
    expect(mixer.state.items[1].state).toBe('playing')
    expect(mixer.state.items[2].deck).toBe('A')
    expect(mixer.state.items[2].state).toBe('loaded')
  })
})

describe('persistence', () => {
  it('writes order and settings to localStorage without autoplaying on read', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    mixer.moveCrossfader(0.8)
    mixer.setFadeDuration(16)
    mixer.setAutoFade({ enabled: true, mode: 'at-time', atSeconds: 90 })
    mixer.moveTrack(0, 1)
    window.dispatchEvent(new Event('pagehide'))

    const raw = localStorage.getItem('youtube-dj-mixer:v1')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw)
    expect(saved.items.map((item) => item.videoId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
    expect(saved.settings.fadeDuration).toBe(16)
    expect(saved.settings.autoFade).toEqual({
      enabled: true,
      mode: 'at-time',
      secondsBeforeEnd: 10,
      atSeconds: 90,
    })
    expect(saved.crossfader).toBe(0.8)
    expect(saved.items.some((item) => item.state === 'playing')).toBe(false)
    expect(wrapper.findAll('.track')).toHaveLength(2)
  })
})
