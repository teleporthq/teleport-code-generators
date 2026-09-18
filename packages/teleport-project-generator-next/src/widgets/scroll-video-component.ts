import { MotionRuntime } from '@teleporthq/teleport-shared'

/**
 * Generates the TqScrollVideo wrapper. A Scroll Video is a LEAF widget that
 * maps scroll progress to VIDEO TIME: the clip is a media-worker "scrub
 * asset" (all-intra encode) so seeking to any frame is cheap — scrubbing IS
 * setting currentTime. Inside a TqScrollScene it follows the scene track's
 * pass (discovered via closest('[data-scene-track]'), pin inferred from the
 * stage's computed sticky position); standalone it scrubs on its own trip
 * through the viewport — a LEGACY FALLBACK kept for bare markup that predates
 * the scene-hosted model (or slipped past it): the editor always inserts the
 * video inside a scene, because the fallback needs ~two screens of
 * surrounding content before any scrubbing is possible. windowStart/windowEnd map a slice of that progress to
 * the whole clip. Pure DOM — no animation library involved; progress math
 * mirrors the canvas renderer's scroll-video-runtime verbatim.
 *
 * Guardrails baked in: prefers-reduced-motion holds the poster (or the final
 * frame with reducedMotion='end'), all measuring work lives in useEffect so
 * SSR never touches the DOM, and seeks requested before metadata arrives are
 * replayed on loadedmetadata. The rendered <video> streams so the first frame
 * shows at once; the clip is then held in memory (bufferWholeClip, shared with
 * the HTML export), whose copy is added next to it outside React's children
 * and removed by the effect's cleanup.
 */
export const generateScrollVideoComponentCode = (): string => {
  return `import React from 'react'

${MotionRuntime.scrollVideoEngineSource()}

const TqScrollVideo = ({
  src = '',
  poster = '',
  mobileSrc = '',
  smoothing = 0.2,
  windowStart = 0,
  windowEnd = 100,
  reducedMotion = 'poster',
  backToStart = false,
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
    const streamed = videoRef.current
    if (!host || !streamed || !activeSrc) {
      return undefined
    }

    const bounds = normalizeWindow(windowStart, windowEnd)
    // The element on screen: the streamed one until the clip held in memory takes over.
    let video = streamed
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
    streamed.addEventListener('loadedmetadata', onMetadata)

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      if (reducedMotion === 'end') {
        seekTo(1)
      }
      // 'poster': never seek — the poster keeps painting until a seek happens.
      return () => streamed.removeEventListener('loadedmetadata', onMetadata)
    }

    const stopBuffering = bufferWholeClip(host, streamed, activeSrc, (copy) => {
      video = copy
      onMetadata()
    })

    const driveTo = (drivingProgress) => {
      const local = (clamp01(drivingProgress) * 100 - bounds.start) / (bounds.end - bounds.start)
      seekTo(clipPositionFor(local, backToStart === true || backToStart === 'true'))
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
      streamed.removeEventListener('loadedmetadata', onMetadata)
      stopBuffering()
    }
  }, [activeSrc, smoothing, windowStart, windowEnd, reducedMotion, backToStart])

  if (!src) {
    return <div ref={hostRef} style={style} data-scroll-video="" {...rest} />
  }

  return (
    // The video is ABSOLUTE on purpose: an in-flow video with height:100%
    // chains a circular percentage through a content-sized wrapper and the
    // page height grows by the rest of the document every layout pass.
    // The wrapper's SIZE comes entirely from the authored styles — as a scene
    // BACKGROUND those are position:absolute + inset:0 (a CSS class), so the
    // wrapper must not carry an inline position of its own: inline beats
    // class, and the old position:'relative' here collapsed the backdrop to a
    // 0px-tall in-flow div — video present in the JSX, invisible on the page.
    // contain:'layout' (after the authored spread, so it always applies)
    // keeps the wrapper the video's containing block even when the author
    // sets position:static.
    // data-scroll-video: the marker TqScrollScene's backdrop rule targets —
    // the scene pins the clip into its stage's negative z band so ordinary
    // scene children (headings, text, CTAs) always render above the video.
    <div
      ref={hostRef}
      style={{ overflow: 'hidden', ...(style || {}), contain: 'layout' }}
      data-scroll-video=""
      {...rest}
    >
      <video
        ref={videoRef}
        src={activeSrc}
        poster={poster || undefined}
        muted
        playsInline
        preload="metadata"
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
