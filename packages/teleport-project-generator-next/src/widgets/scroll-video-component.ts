/**
 * Generates the TqScrollVideo wrapper. A Scroll Video is a LEAF widget that
 * maps scroll progress to VIDEO TIME: the clip is a media-worker "scrub
 * asset" (all-intra encode) so seeking to any frame is cheap — scrubbing IS
 * setting currentTime. Inside a TqScrollScene it follows the scene track's
 * pass (discovered via closest('[data-scene-track]'), pin inferred from the
 * stage's computed sticky position); standalone it scrubs on its own trip
 * through the viewport. windowStart/windowEnd map a slice of that progress to
 * the whole clip. Pure DOM — no animation library involved; progress math
 * mirrors the canvas renderer's scroll-video-runtime verbatim.
 *
 * Guardrails baked in: prefers-reduced-motion holds the poster (or the final
 * frame with reducedMotion='end'), all measuring work lives in useEffect so
 * SSR never touches the DOM, and seeks requested before metadata arrives are
 * replayed on loadedmetadata.
 */
export const generateScrollVideoComponentCode = (): string => {
  return `import React from 'react'

const clamp01 = (value) => Math.min(1, Math.max(0, value))

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

const TqScrollVideo = ({
  src = '',
  poster = '',
  mobileSrc = '',
  smoothing = 0.2,
  windowStart = 0,
  windowEnd = 100,
  reducedMotion = 'poster',
  style,
  ...rest
}) => {
  const hostRef = React.useRef(null)
  const videoRef = React.useRef(null)
  const [activeSrc, setActiveSrc] = React.useState(src)

  React.useEffect(() => {
    const useMobile =
      mobileSrc &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px)').matches
    setActiveSrc(useMobile ? mobileSrc : src)
  }, [src, mobileSrc])

  React.useEffect(() => {
    const host = hostRef.current
    const video = videoRef.current
    if (!host || !video || !activeSrc) {
      return undefined
    }

    const bounds = normalizeWindow(windowStart, windowEnd)
    let lastClip = -1
    let pendingClip = 0

    const seekTo = (clipProgress) => {
      pendingClip = clipProgress
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0) {
        return
      }
      if (Math.abs(clipProgress - lastClip) * duration < 1 / 120) {
        return
      }
      lastClip = clipProgress
      video.currentTime = clipProgress * duration
    }

    const onMetadata = () => {
      lastClip = -1
      seekTo(pendingClip)
    }
    video.addEventListener('loadedmetadata', onMetadata)

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      if (reducedMotion === 'end') {
        seekTo(1)
      }
      // 'poster': never seek — the poster keeps painting until a seek happens.
      return () => video.removeEventListener('loadedmetadata', onMetadata)
    }

    const driveTo = (drivingProgress) => {
      const local = (clamp01(drivingProgress) * 100 - bounds.start) / (bounds.end - bounds.start)
      seekTo(clamp01(local))
    }

    const sceneTrack = host.closest('[data-scene-track]')
    const measured = sceneTrack || host
    const stage = sceneTrack ? sceneTrack.querySelector(':scope > [data-scene-stage]') : null
    const offset =
      sceneTrack && stage && window.getComputedStyle(stage).position === 'sticky'
        ? 'contained'
        : 'pass'

    let current = 0
    let rafId = 0
    let lastTs = 0

    const targetProgress = () =>
      progressForRect(measured.getBoundingClientRect(), window.innerHeight || 1, offset)

    const smoothTick = (ts) => {
      rafId = 0
      const target = targetProgress()
      const dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60
      lastTs = ts
      const alpha = 1 - Math.exp(-dt / Math.max(0.05, smoothing / 3))
      const next = current + (target - current) * alpha
      current = Math.abs(target - next) < 0.001 ? target : next
      driveTo(current)
      if (current !== target) {
        rafId = window.requestAnimationFrame(smoothTick)
      } else {
        lastTs = 0
      }
    }

    const update = () => {
      if (smoothing > 0) {
        if (!rafId) {
          rafId = window.requestAnimationFrame(smoothTick)
        }
        return
      }
      current = targetProgress()
      driveTo(current)
    }

    current = targetProgress()
    driveTo(current)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)

    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      video.removeEventListener('loadedmetadata', onMetadata)
    }
  }, [activeSrc, smoothing, windowStart, windowEnd, reducedMotion])

  if (!src) {
    return <div ref={hostRef} style={style} {...rest} />
  }

  return (
    // The video is ABSOLUTE on purpose: an in-flow video with height:100%
    // chains a circular percentage through a content-sized wrapper and the
    // page height grows by the rest of the document every layout pass.
    // The wrapper (aspect-ratio / authored styles) owns the size, and
    // contain:'layout' (after the authored spread, so it always applies)
    // keeps the wrapper the video's containing block even when the author
    // sets position:static.
    <div
      ref={hostRef}
      style={{ position: 'relative', overflow: 'hidden', ...(style || {}), contain: 'layout' }}
      {...rest}
    >
      <video
        ref={videoRef}
        src={activeSrc}
        poster={poster || undefined}
        muted
        playsInline
        preload="auto"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

export default TqScrollVideo
`
}
