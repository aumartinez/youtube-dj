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

  it('rejects a playlist link without a list id', async () => {
    const wrapper = await mountApp()
    await submitUrl(wrapper, 'https://www.youtube.com/playlist')

    expect(wrapper.text()).toContain('public YouTube playlist')
    expect(wrapper.findAll('.track')).toHaveLength(0)
  })
})

describe('loading a specific track', () => {
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

describe('natural end', () => {
  it('cues the next queued item into the ended deck without playing it', async () => {
    const wrapper = await mountApp()
    await addTrack(wrapper, 'https://youtu.be/aaaaaaaaaaa')
    await addTrack(wrapper, 'https://youtu.be/bbbbbbbbbbb')

    await click(deck(wrapper, 'A'), 'Play')
    const playerA = FakePlayer.instances[0]

    playerA.end()
    await flushPromises()

    expect(mixer.state.items[0].state).toBe('played')
    expect(mixer.state.items[1].state).toBe('loaded')
    expect(mixer.state.items[1].deck).toBe('A')
    expect(mixer.state.decks.A.playing).toBe(false)
    expect(playerA.videoId).toBe('bbbbbbbbbbb')
    expect(wrapper.text()).toContain('is cued, not playing')
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
