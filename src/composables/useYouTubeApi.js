/**
 * Loads the official YouTube IFrame Player API once per page.
 *
 * The API is a global script that calls window.onYouTubeIframeAPIReady.
 * We also poll for window.YT.Player because the callback can be consumed by
 * another loader, and we fail with a real error (instead of hanging forever)
 * when the network or an extension blocks the script.
 */

const API_SRC = 'https://www.youtube.com/iframe_api'
let apiPromise = null

export function loadYouTubeApi({ timeoutMs = 15000 } = {}) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('The YouTube IFrame API requires a browser.'))
  }
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    let settled = false
    let pollId = null

    const cleanup = () => {
      clearTimeout(timeoutId)
      if (pollId !== null) clearInterval(pollId)
    }

    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(window.YT)
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      apiPromise = null
      reject(error)
    }

    const timeoutId = setTimeout(() => {
      fail(new Error('Timed out while loading the YouTube IFrame API.'))
    }, timeoutMs)

    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous()
      if (window.YT?.Player) succeed()
    }

    let script = document.querySelector('script[data-youtube-iframe-api]')
    if (!script) {
      script = document.createElement('script')
      script.src = API_SRC
      script.async = true
      script.dataset.youtubeIframeApi = 'true'
      script.addEventListener('error', () => fail(new Error('The YouTube IFrame API script failed to load.')))
      document.head.appendChild(script)
    }

    if (window.YT?.Player) {
      succeed()
      return
    }

    pollId = setInterval(() => {
      if (window.YT?.Player) succeed()
    }, 250)
  })

  return apiPromise
}

/** Test/reset helper: forget the in-flight promise so a retry can load again. */
export function resetYouTubeApiLoader() {
  apiPromise = null
}
