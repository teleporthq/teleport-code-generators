import { ScrollSceneRuntime } from '@teleporthq/teleport-shared'

/**
 * Generates the TqScrollScene wrapper. A Scroll Scene is a CONTAINER widget:
 * a tall TRACK (sceneLength) with a `position: sticky` STAGE pinned inside it.
 * The track's pass-through progress (framer-motion useScroll, optionally
 * useSpring-smoothed by `scrub`) drives every descendant carrying a
 * `data-scroll-bind` attribute — multi-keyframe property lanes applied by DOM
 * QUERY with a MutationObserver, so items rendered later (a runtime
 * <Repeater>'s children) are picked up and React child introspection is never
 * involved. Lane parsing/presets/interpolation mirror the canvas renderer's
 * scroll-scene-lanes module verbatim so the canvas and the published site
 * behave identically.
 *
 * Guardrails baked in: compositor-only lane properties, prefers-reduced-motion
 * ('final' settles on the end state, 'static' stays put), progress exposed as
 * --scene-progress only when exposeProgress is set, and a dev-only warning
 * when an ancestor's overflow silently disables the sticky pinning.
 */
export const generateScrollSceneComponentCode = (): string => {
  return `import React from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'

${ScrollSceneRuntime.engineSource()}

const TqScrollScene = ({
  sceneLength = '300vh',
  pin = true,
  scrub = 0.3,
  reducedMotion = 'final',
  exposeProgress = false,
  layout = 'chapters',
  chapterSnap = 'off',
  style,
  children,
  ...rest
}) => {
  const trackRef = React.useRef(null)
  const boundRef = React.useRef([])
  const progressRef = React.useRef(0)
  const shouldReduceMotion = useReducedMotion()
  const chapterHelpersRef = React.useRef(null)
  const chapterStateRef = React.useRef({
    records: null,
    moments: null,
    index: -1,
    element: null,
    lastProgress: 0,
    onScreen: false,
    pending: null,
  })
  const scenePointStateRef = React.useRef({ last: null, pending: [], scheduled: false })

${ScrollSceneRuntime.announcementsSource()}

  const applyAll = React.useCallback(
    (p) => {
      progressRef.current = p
      for (const child of boundRef.current) {
        try {
          applyLanesAt(child.element, child.lanes, p)
        } catch (e) {
          // a broken binding must never break the page
        }
      }
      if (exposeProgress && trackRef.current) {
        trackRef.current.style.setProperty('--scene-progress', String(Math.round(p * 1000) / 1000))
      }
      announceChapter(p)
      announceScenePoints(p)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exposeProgress]
  )

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: pin ? ['start start', 'end end'] : ['start end', 'end start'],
  })
  const scrubSeconds = Number(scrub) || 0
  const smoothed = useSpring(scrollYProgress, {
    duration: Math.max(1, scrubSeconds * 1000),
    bounce: 0,
  })
  const progress = scrubSeconds > 0 ? smoothed : scrollYProgress

  useMotionValueEvent(progress, 'change', (p) => {
    if (!shouldReduceMotion) {
      applyAll(p)
    }
  })

  // layout='chapters': pin every REAL grid item of the stage into the same
  // cell. The CSS child rule handles plain children; this pass additionally
  // descends through display:contents wrappers (whose children — not they —
  // are the grid items), pierces open shadow roots/slots, and re-runs when a
  // not-yet-upgraded web component defines (pre-upgrade its
  // :host{display:contents} doesn't exist, so it reads as a box and upgrades
  // fire no mutation). Mirrors the editor runtime.
  const restackRef = React.useRef(null)
  const awaitedTagsRef = React.useRef(null)
  if (awaitedTagsRef.current === null) {
    awaitedTagsRef.current = new Set()
  }
  const restack = React.useCallback(() => {
${ScrollSceneRuntime.restackBodySource()}
  }, [layout])
  restackRef.current = restack

  // A pinned scene at the page's edge exposes the html canvas when the user
  // overscrolls (the macOS rubber-band): a white band above or below a dark
  // scene. Two treatments, both only on pages that have a scene: the bounce
  // is switched off where the browser honors overscroll-behavior on the root
  // (Chrome, Edge, Firefox, Android), and the html canvas takes the page's
  // own background color so the stretch Safari still shows is invisible.
  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    if (!root.style.backgroundColor) {
      const bodyBackground = window.getComputedStyle(document.body).backgroundColor
      if (bodyBackground && bodyBackground !== 'rgba(0, 0, 0, 0)' && bodyBackground !== 'transparent') {
        root.style.backgroundColor = bodyBackground
      }
    }
  }, [])

  React.useEffect(() => {
    const track = trackRef.current
    if (!track) {
      return undefined
    }
    // A pinned stage needs every ancestor to be pinnable — see unclipStickyAncestors.
    if (pin) {
      unclipStickyAncestors(track, (element) => window.getComputedStyle(element))
    }
    boundRef.current = collectBound(track)
    restack()

    // Chapters are announced for reduced-motion visitors too (their workflows
    // must still run), from the one progress the scene settles on.
    applyAll(shouldReduceMotion ? (reducedMotion === 'static' ? 0 : 1) : progress.get())

    // Repeater items render after mount, and bindings may be rewritten in
    // place on existing elements (attribute-only mutations) — watch both,
    // mirroring the editor runtime. The attributeFilter keeps our own style
    // writes from feeding back into the observer.
    const observer = new MutationObserver(() => {
      boundRef.current = collectBound(track)
      restack()
      chapterStateRef.current.records = null
      applyAll(progressRef.current)
    })
    observer.observe(track, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-scroll-bind'],
    })

    // Chapters are only announced while the scene is on screen: progress is 0
    // for every scene still below the fold, so the observer owns that fact and
    // re-evaluates the moment the scene arrives.
    const visibility =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            chapterStateRef.current.onScreen = entries.some((entry) => entry.isIntersecting)
            announceChapter(progressRef.current)
          })
        : null
    if (visibility) {
      visibility.observe(track)
    } else {
      chapterStateRef.current.onScreen = true
      announceChapter(progressRef.current)
    }

    if (process.env.NODE_ENV !== 'production' && pin) {
      let ancestor = track.parentElement
      while (ancestor && ancestor !== document.body) {
        const overflow = getComputedStyle(ancestor)
        if (
          [overflow.overflow, overflow.overflowX, overflow.overflowY].some(
            (value) => value && value !== 'visible'
          )
        ) {
          console.warn(
            '[TqScrollScene] ancestor with overflow "' +
              overflow.overflow +
              '" disables sticky pinning — the scene will scroll instead of pin:',
            ancestor
          )
          break
        }
        ancestor = ancestor.parentElement
      }
    }

    return () => {
      observer.disconnect()
      if (visibility) {
        visibility.disconnect()
      }
      // An announcement still pending is dropped with the effect; the re-run
      // starts from nothing announced, so the chapter on stage is announced again.
      const state = chapterStateRef.current
      state.pending = null
      state.records = null
      state.index = -1
      stampChapter(null, 0, 0)
      const points = scenePointStateRef.current
      points.last = null
      points.pending = []
      points.scheduled = false
      track.removeAttribute(SCENE_POINT_ATTR)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldReduceMotion, reducedMotion, pin, applyAll, restack])

  // Chapter geometry, shared by anchor navigation and chapter snap: the
  // moment a chapter is "on stage" is the midpoint of its story window
  // (data-chapter-window when the editor recorded one, else the span of its
  // data-scroll-bind stops), and a progress maps to the document position
  // trackTop + progress * (trackHeight - viewport).
${ScrollSceneRuntime.chapterHelpersSource()}

  // Anchor navigation into a pinned scene. Chapters stack inside the sticky
  // stage, so the browser's native jump to a chapter's id lands at the
  // element's DOCUMENT position (the top of the track) — never at the moment
  // the chapter is on stage. Hash navigation is translated to progress
  // instead. Same-page anchor clicks are intercepted for a single smooth
  // ride; the hashchange listener covers programmatic navigation, and the
  // mount pass covers arriving on a URL that already carries the hash.
  React.useEffect(() => {
${ScrollSceneRuntime.anchorNavigationBodySource()}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  // Gentle chapter snap (scene-chapter-snap="gentle"): when the visitor
  // PAUSES mid-scene, the story settles on the nearest chapter's moment.
  // Deliberately not wheel hijacking — nothing intercepts an in-flight
  // scroll, trackpad momentum stays native, and a scrubbed background video
  // simply glides a short segment to the chapter's frame. Reduced-motion
  // visitors are never moved.
  React.useEffect(() => {
${ScrollSceneRuntime.gentleSnapBodySource()}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, chapterSnap, shouldReduceMotion])

  // MIN-heights, never exact heights — mirrors the canvas renderer: an exact
  // height turned any content taller than one screen into an overflow the next
  // section painted straight over. A minimum keeps the full-screen chapter look
  // for short content and extends the stage for tall content.
  const trackStyle = pin
    ? { ...(style || {}), minHeight: normalizeSceneLength(sceneLength), position: 'relative' }
    : style

  return (
    // data-scene-track: the discovery hook for scene-aware widgets (TqScrollVideo
    // finds its driving scene with closest('[data-scene-track]')).
    <div ref={trackRef} style={trackStyle} data-scene-track {...rest}>
      {pin ? (
        <div
          style={{
            position: 'sticky',
            top: 0,
            minHeight: '100vh',
            // Travelling lanes (rail-x, rise-in, crash-zoom) must not spill a
            // scrollbar onto the page; overflow on the sticky element itself
            // never disables pinning. isolation keeps scene-internal stacking
            // from fighting the page. Mirrors the canvas renderer.
            overflow: 'hidden',
            isolation: 'isolate',
            // Vanishing point for 3D lanes (rotate: x/y …) on any child.
            perspective: '900px',
            // layout='chapters': the stage IS the centering grid and every
            // direct child stacks in the same cell (rule below) — the
            // scrollytelling shape with zero hand-written wrapper styles.
            ...(layout === 'chapters' ? { display: 'grid', placeItems: 'center' } : {}),
          }}
          data-scene-stage
          data-scene-layout={layout === 'chapters' ? 'chapters' : undefined}
        >
          {/* dangerouslySetInnerHTML, NOT a text child: React SSR escapes text
              inside <style> ('>' -> '&gt;'), and style is a raw-text element so
              the browser never decodes it — the selector would break on the
              server AND hydration would fail on the text mismatch.
              Backdrop rule: an absolutely positioned clip paints ABOVE static
              in-flow siblings (a plain heading next to the video vanished
              behind the clip), so the scene pins its clip into the stage's
              negative z band — isolation:isolate above keeps -1 inside the
              scene. Scene-owned so it holds however the clip arrived. The same
              band holds every backdrop: a bare media child or anything marked
              data-scene-backdrop (run 4984b05b: an AI-authored backdrop photo
              painted over three chapters of white text — the story read as a
              still wall). */}
          <style
            dangerouslySetInnerHTML={{
              __html:
                'html { overscroll-behavior-y: none; } ' +
                '[data-scene-stage] > [data-scroll-video], [data-scene-stage] > [data-scene-backdrop], [data-scene-stage] > img, [data-scene-stage] > video, [data-scene-stage] > picture { position: absolute; inset: 0; z-index: -1; } ' +
                '[data-scene-stage] > img, [data-scene-stage] > video, [data-scene-stage] > picture > img { width: 100%; height: 100%; object-fit: cover; } ' +
                COUNT_CSS +
                ' ' +
                HIDDEN_CSS +
                (layout === 'chapters'
                  ? ' [data-scene-stage][data-scene-layout="chapters"] > :not(style) { grid-area: 1 / 1; width: 100%; }'
                  : ''),
            }}
          />
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export default TqScrollScene
`
}
