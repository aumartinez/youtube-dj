/**
 * YouTube URL helpers. Everything here is pure so it can be unit tested
 * and reused by the store without touching the IFrame API.
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/
const PATH_PREFIXES = new Set(['embed', 'shorts', 'live', 'v', 'e'])
const ALLOWED_DOMAINS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

export function isVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value)
}

function isYouTubeHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '')
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** Parses a URL-ish string and returns it only for known YouTube hosts. */
function parseYouTubeUrl(input) {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
  let url
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  return isYouTubeHost(url.hostname) ? url : null
}

function hasExplicitVideo(url) {
  return url.searchParams.getAll('v').length > 0 || /^\/(embed|shorts|live|v|e)\//i.test(url.pathname)
}

/**
 * Accepts a bare video id or any common YouTube URL shape:
 * watch?v=, youtu.be/, /embed/, /shorts/, /live/, /v/, music.youtube.com,
 * youtube-nocookie.com. Returns null for anything else.
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null

  const value = input.trim()
  if (!value) return null
  if (isVideoId(value)) return value

  const url = parseYouTubeUrl(value)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'youtu.be') {
    const [id] = url.pathname.split('/').filter(Boolean)
    return isVideoId(id) ? id : null
  }

  // `?v=A&v=B` is ambiguous, so refuse instead of guessing.
  const vParams = url.searchParams.getAll('v')
  if (vParams.length > 1) return null
  if (vParams.length === 1) return isVideoId(vParams[0]) ? vParams[0] : null

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && PATH_PREFIXES.has(segments[0].toLowerCase())) {
    return isVideoId(segments[1]) ? segments[1] : null
  }

  return null
}

/** Playlist id from `?list=`, for public playlists only. */
export function extractPlaylistId(input) {
  const url = parseYouTubeUrl(input)
  if (!url) return null
  const list = url.searchParams.get('list')
  return typeof list === 'string' && PLAYLIST_ID_PATTERN.test(list) ? list : null
}

/**
 * True when the string points at a playlist rather than a single video:
 * `/playlist?list=…` or any URL with `list=` but no video. A watch URL that
 * has both `v` and `list` is treated as a single video.
 */
export function isPlaylistUrl(input) {
  const url = parseYouTubeUrl(input)
  if (!url) return false
  if (hasExplicitVideo(url)) return false
  if (url.searchParams.has('list')) return true
  return url.pathname.replace(/\/+$/, '').toLowerCase() === '/playlist'
}

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** Keyless poster image. Cheaper and safer than asking the API for metadata. */
export function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

/** Keyless metadata lookup; may fail (offline, CORS, removed video) and is best-effort. */
export function oEmbedUrl(videoId) {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`
}

export function formatClock(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
