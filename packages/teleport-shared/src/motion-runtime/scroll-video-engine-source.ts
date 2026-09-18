/**
 * The scroll-video maths as SOURCE TEXT: the clip window, the progress a
 * rectangle has made through the viewport, and the clip held in memory. Shared
 * word for word by the Next export (TqScrollVideo) and the HTML export's
 * vanilla controller; mirrors the canvas renderer's scroll-video-runtime and
 * its full-file buffering.
 */
export const scrollVideoEngineSource =
  (): string => `const clamp01 = (value) => Math.min(1, Math.max(0, value))

const MIN_WINDOW_SPAN = 1

const normalizeWindow = (startRaw, endRaw) => {
  const parse = (value, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback
  }
  const start = parse(startRaw, 0)
  const end = parse(endRaw, 100)
  if (end - start >= MIN_WINDOW_SPAN) {
    return { start, end }
  }
  return start <= 100 - MIN_WINDOW_SPAN
    ? { start, end: start + MIN_WINDOW_SPAN }
    : { start: 100 - MIN_WINDOW_SPAN, end: 100 }
}

// Mirrors the canvas renderer's scrollProgressForOffset for the two modes a
// scrub video needs: 'contained' (a pinned scene's stage holds while its track
// scrolls under it) and 'pass' (a plain trip through the viewport).
const progressForRect = (rect, viewportHeight, offset) => {
  const vh = viewportHeight || 1
  let raw
  if (offset === 'contained') {
    const travel = rect.height - vh
    raw = travel > 0 ? -rect.top / travel : (vh - rect.top) / (vh + rect.height)
  } else {
    raw = (vh - rect.top) / (vh + rect.height)
  }
  return clamp01(raw)
}

// Where in the clip a window progress lands. Played back to the start, the
// clip reaches its last frame halfway through the window and its first frame
// again at the end (the editor's clipPositionForWindowProgress, word for word).
const clipPositionFor = (windowProgress, backToStart) => {
  const position = clamp01(windowProgress)
  if (!backToStart) {
    return position
  }
  return position <= 0.5 ? position * 2 : (1 - position) * 2
}

// The whole clip in memory, so a seek never waits on the network: a scrub
// seeks everywhere, and a streaming <video> holds only what it has fetched
// around the playhead (Safari on iPhone fetches nothing ahead), so a fast
// scroll outruns it and the frame freezes. The clip is fetched once its scene
// is about a screen away (the assets bucket allows it from any site). The
// streamed element keeps scrubbing meanwhile; then a copy playing from memory
// takes its place at the frame on screen and the streamed one lets go of its
// download. A fresh element, not a new src on the old one: engines get stuck
// after a src swap on an element that has already seeked. The page asks the
// streamed element for its first frame only (preload="metadata"), so the clip
// is not downloaded twice; where the clip cannot be held (a host that refuses,
// a clip too big, no fetch) it goes back to preloading the way it streamed
// before. A visitor saving data keeps the first frame only.
const MAX_BUFFERED_CLIP_BYTES = 100 * 1024 * 1024

const bufferWholeClip = (host, video, src, onSwap) => {
  const stream = () => {
    video.preload = 'auto'
  }
  if (navigator.connection && navigator.connection.saveData) {
    return () => {}
  }
  if (!src || /^(blob|data):/.test(src) || typeof fetch !== 'function' || !window.URL || !URL.createObjectURL) {
    stream()
    return () => {}
  }
  let stopped = false
  let observer = null
  let objectUrl = null
  let copy = null
  let released = false
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const takeOver = () => {
    if (stopped) {
      return
    }
    copy.style.opacity = ''
    video.style.display = 'none'
    video.removeAttribute('src')
    video.load()
    released = true
    onSwap(copy)
  }
  const load = () => {
    fetch(src, controller ? { signal: controller.signal } : undefined)
      .then((response) => {
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_BUFFERED_CLIP_BYTES) {
          throw new Error('keep streaming')
        }
        return response.blob()
      })
      .then((blob) => {
        if (stopped) {
          return
        }
        objectUrl = URL.createObjectURL(blob)
        copy = video.cloneNode(false)
        copy.muted = true
        copy.style.opacity = '0'
        copy.addEventListener('loadedmetadata', () => {
          copy.addEventListener('seeked', takeOver, { once: true })
          copy.currentTime = video.currentTime
        }, { once: true })
        copy.src = objectUrl
        video.parentNode.insertBefore(copy, video.nextSibling)
      })
      .catch(() => {
        if (!stopped) {
          stream()
        }
      })
  }
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        observer = null
        load()
      }
    }, { rootMargin: '100% 0px' })
    observer.observe(host)
  } else {
    load()
  }
  return () => {
    stopped = true
    if (observer) {
      observer.disconnect()
    }
    if (controller) {
      controller.abort()
    }
    if (copy) {
      copy.remove()
    }
    video.style.display = ''
    if (released && video.isConnected && !video.getAttribute('src')) {
      video.setAttribute('src', src)
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}`
