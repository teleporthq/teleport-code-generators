import { MotionRuntime, ScrollSceneRuntime } from '@teleporthq/teleport-shared'
import { MOTION_MARKER_ATTR, MOTION_READY_ATTR, RUNTIME_FLAG } from './contract'

/**
 * The motion runtime of a static HTML export: one plain script, no library.
 *
 * The Next export animates with framer-motion inside React components. A
 * downloaded HTML site has neither, so the same behaviour is driven here by a
 * scroll listener, requestAnimationFrame and the Web Animations API. What an
 * element DOES at a given progress is not re-implemented: the lane engine, the
 * preset table, the chapter logic and the video maths are the shared source
 * text the Next widgets are built from (teleport-shared), so both exports move
 * identically and a new preset reaches both at once. Only the part framer used
 * to supply is written here: where the progress comes from and how an entrance
 * is played.
 *
 * Every module is its own function scope, so the engines' names never collide,
 * and only the modules a project uses are emitted.
 */

/** Scroll progress of a rectangle, the way the canvas and framer's offsets define it. */
const PROGRESS_SOURCE = `const scrollProgressForOffset = (rect, viewportHeight, offset) => {
  const vh = viewportHeight || 1
  let raw
  if (offset === 'contained') {
    const travel = rect.height - vh
    raw = travel > 0 ? -rect.top / travel : (vh - rect.top) / (vh + rect.height)
  } else if (offset === 'enter') {
    raw = (vh - rect.top) / vh
  } else if (offset === 'exit') {
    raw = (vh - rect.bottom) / vh
  } else {
    raw = (vh - rect.top) / (vh + rect.height)
  }
  return Math.min(1, Math.max(0, raw))
}

// Follows a scroll-driven progress. With smoothing the value eases toward the
// scroll position over roughly that many seconds (the spring framer supplies
// in the Next export); without it the value is the scroll position itself.
const followProgress = (measure, smoothingSeconds, apply) => {
  let current = measure()
  let frame = 0
  let lastTs = 0
  const tick = (ts) => {
    frame = 0
    const target = measure()
    if (smoothingSeconds > 0) {
      const dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60
      lastTs = ts
      const alpha = 1 - Math.exp(-dt / Math.max(0.05, smoothingSeconds / 3))
      const next = current + (target - current) * alpha
      current = Math.abs(target - next) < 0.0005 ? target : next
    } else {
      current = target
    }
    apply(current)
    if (current !== target) {
      frame = window.requestAnimationFrame(tick)
    } else {
      lastTs = 0
    }
  }
  const schedule = () => {
    if (!frame) {
      frame = window.requestAnimationFrame(tick)
    }
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  return { get: () => current }
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const whenParsed = (boot) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}`

const sceneModule = (): string => `;(function () {
${PROGRESS_SOURCE}

${ScrollSceneRuntime.engineSource()}

const initScene = (track) => {
  const readAttr = (name, fallback) => {
    const value = track.getAttribute(name)
    return value === null || value === '' ? fallback : value
  }
  const pin = readAttr('data-scene-pin', 'true') !== 'false'
  const scrubSeconds = Number(readAttr('data-scene-scrub', '0.3')) || 0
  const reducedMotion = readAttr('data-scene-reduced-motion', 'final')
  const exposeProgress = readAttr('data-scene-expose-progress', 'false') === 'true'
  const chapterSnap = readAttr('data-scene-chapter-snap', 'off')
  const stageElement = track.querySelector(':scope > [data-scene-stage]')
  const layout =
    stageElement && stageElement.getAttribute('data-scene-layout') === 'chapters' ? 'chapters' : 'flow'
  const shouldReduceMotion = prefersReducedMotion()

  // The names the shared controller blocks expect (refs and props in React).
  const trackRef = { current: track }
  const boundRef = { current: [] }
  const progressRef = { current: 0 }
  const chapterHelpersRef = { current: null }
  const chapterStateRef = {
    current: {
      records: null,
      moments: null,
      index: -1,
      element: null,
      lastProgress: 0,
      onScreen: false,
      pending: null,
    },
  }
  const scenePointStateRef = { current: { last: null, pending: [], scheduled: false } }
  const restackRef = { current: null }
  const awaitedTagsRef = { current: new Set() }

${ScrollSceneRuntime.announcementsSource()}

${ScrollSceneRuntime.chapterHelpersSource()}

  const restack = () => {
${ScrollSceneRuntime.restackBodySource()}
  }
  restackRef.current = restack

  const applyAll = (p) => {
    progressRef.current = p
    for (const child of boundRef.current) {
      try {
        applyLanesAt(child.element, child.lanes, p)
      } catch (e) {
        // a broken binding must never break the page
      }
    }
    if (exposeProgress) {
      track.style.setProperty('--scene-progress', String(Math.round(p * 1000) / 1000))
    }
    announceChapter(p)
    announceScenePoints(p)
  }

  // A pinned stage needs every ancestor to be pinnable.
  if (pin) {
    unclipStickyAncestors(track, (element) => window.getComputedStyle(element))
  }
  boundRef.current = collectBound(track)
  restack()

  const measure = () =>
    scrollProgressForOffset(
      track.getBoundingClientRect(),
      window.innerHeight || 1,
      pin ? 'contained' : 'pass'
    )
  // Reduced-motion visitors get the story's settled state and no scroll work;
  // chapters are still announced for them, from the one progress it settles on.
  if (shouldReduceMotion) {
    applyAll(reducedMotion === 'static' ? 0 : 1)
  } else {
    applyAll(measure())
    followProgress(measure, scrubSeconds, applyAll)
  }

  // Items can arrive after the first pass and bindings can be rewritten in
  // place; the attributeFilter keeps the runtime's own style writes out.
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

  // Chapters are only announced while the scene is on screen.
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      chapterStateRef.current.onScreen = entries.some((entry) => entry.isIntersecting)
      announceChapter(progressRef.current)
    }).observe(track)
  } else {
    chapterStateRef.current.onScreen = true
    announceChapter(progressRef.current)
  }

  ;(() => {
${ScrollSceneRuntime.anchorNavigationBodySource()}
  })()

  ;(() => {
${ScrollSceneRuntime.gentleSnapBodySource()}
  })()
}

whenParsed(() => {
  const tracks = Array.from(document.querySelectorAll('[data-scene-track]'))
  if (tracks.length === 0) {
    return
  }
  // A pinned scene at the page's edge shows the html canvas on overscroll: give
  // it the page's own background so the stretch is invisible.
  const root = document.documentElement
  if (!root.style.backgroundColor) {
    const bodyBackground = window.getComputedStyle(document.body).backgroundColor
    if (bodyBackground && bodyBackground !== 'rgba(0, 0, 0, 0)' && bodyBackground !== 'transparent') {
      root.style.backgroundColor = bodyBackground
    }
  }
  tracks.forEach((track) => {
    try {
      initScene(track)
    } catch (e) {
      // one broken scene must never take the page's other scenes down
    }
  })
})
})()`

const motionModule = (): string => `;(function () {
${PROGRESS_SOURCE}

${MotionRuntime.motionEngineSource()}

const READY_ATTR = '${MOTION_READY_ATTR}'

const isNeutral = (value, neutral) => value === undefined || Number(value) === neutral

// Once an entrance has played, the element rests on its end state written
// inline, and a transform that ended at its neutral value is dropped so the
// element stops being a containing block (what framer leaves behind too).
const settleOn = (element, state) => {
  const css = cssFromState(state)
  Object.keys(css).forEach((prop) => {
    element.style[prop] = String(css[prop])
  })
  if (isNeutral(state.x, 0) && isNeutral(state.y, 0)) {
    element.style.removeProperty('translate')
  }
  if (isNeutral(state.scale, 1)) {
    element.style.removeProperty('scale')
  }
  if (isNeutral(state.rotate, 0)) {
    element.style.removeProperty('rotate')
  }
}

const keyframeFrom = (state) => {
  const css = cssFromState(state)
  const frame = {}
  Object.keys(css).forEach((prop) => {
    frame[prop] = String(css[prop])
  })
  return frame
}

// The elements a stagger cascades across: descend through single-child
// wrappers (a lone grid block) to the real repeated items. Null when there is
// nothing to cascade, and the whole block animates as one group instead.
const staggerTargets = (nodes, depth) => {
  if (nodes.length > 1 || depth >= 3) {
    return nodes
  }
  const only = nodes[0]
  if (only && only.children.length > 0) {
    return staggerTargets(Array.from(only.children), depth + 1)
  }
  return null
}

const initMotion = (element) => {
  const text = (name, fallback) => {
    const value = element.getAttribute('data-motion-' + name)
    return value === null || value === '' ? fallback : value
  }
  const number = (name, fallback) => {
    const parsed = Number(text(name, ''))
    return text(name, '') !== '' && Number.isFinite(parsed) ? parsed : fallback
  }
  const json = (name) => {
    try {
      const parsed = JSON.parse(text(name, 'null'))
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (e) {
      return null
    }
  }
  const markReady = () => element.setAttribute(READY_ATTR, '')

  if (prefersReducedMotion()) {
    markReady()
    return
  }

  const trigger = text('trigger', 'in-view')
  const duration = number('duration', 0.6) || 0.6
  const delay = number('delay', 0)
  const stagger = number('stagger', 0)
  const repeat = number('repeat', 0)
  const repeatCount = repeat < 0 ? Infinity : repeat
  const repeatType = text('repeat-type', 'loop')
  const once = text('in-view-once', 'true') !== 'false'
  const amount = number('in-view-amount', 0.3) || 0.3
  const base = presetStates(text('preset', 'fade-in'), number('distance', 40))
  const fromVars = Object.assign({}, base.from, json('from') || {})
  const toVars = Object.assign({}, base.to, json('to') || {})
  const ease = EASINGS[text('easing', 'ease-out')] || EASINGS['ease-out']
  const easeCss = 'cubic-bezier(' + ease.join(', ') + ')'
  const timing = {
    duration: duration * 1000,
    delay: delay * 1000,
    easing: easeCss,
    iterations: repeatCount === Infinity ? Infinity : repeatCount + 1,
    direction: repeatType === 'loop' ? 'normal' : 'alternate',
    fill: 'both',
  }

  if (trigger === 'scroll') {
    const measure = () =>
      scrollProgressForOffset(
        element.getBoundingClientRect(),
        window.innerHeight || 1,
        text('scroll-offset', 'pass')
      )
    const apply = (p) => applyScrollState(element, fromVars, toVars, p)
    apply(measure())
    followProgress(measure, number('scrub', 0), apply)
    markReady()
    return
  }

  if (trigger === 'hover' || trigger === 'tap') {
    let animation = null
    const play = (rate) => {
      if (!animation) {
        animation = element.animate([keyframeFrom(toVars)], timing)
        animation.pause()
      }
      animation.playbackRate = rate
      animation.play()
    }
    if (trigger === 'hover') {
      element.addEventListener('pointerenter', () => play(1))
      element.addEventListener('pointerleave', () => play(-1))
    } else {
      element.addEventListener('pointerdown', () => play(1))
      const release = () => play(-1)
      element.addEventListener('pointerup', release)
      element.addEventListener('pointerleave', release)
      element.addEventListener('pointercancel', release)
    }
    markReady()
    return
  }

  // Entrances: on load, or when the element comes into view.
  const targets =
    stagger > 0 && repeatCount === 0 ? staggerTargets(Array.from(element.children), 0) : null
  let enter
  let leave
  if (targets) {
    // The cascade runs IN PLACE, as CSS transitions on the items themselves:
    // no wrapper is added between a grid or flex container and its items.
    const fromCss = keyframeFrom(fromVars)
    const toCss = keyframeFrom(toVars)
    const animated = Object.keys(fromCss).concat(
      Object.keys(toCss).filter((prop) => fromCss[prop] === undefined)
    )
    const cssName = (prop) => prop.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
    const write = (css) =>
      targets.forEach((target) => {
        Object.keys(css).forEach((prop) => {
          target.style[prop] = css[prop]
        })
      })
    write(fromCss)
    targets.forEach((target, index) => {
      const delaySeconds = delay + index * stagger
      target.style.transition = animated
        .map((prop) => cssName(prop) + ' ' + duration + 's ' + easeCss + ' ' + delaySeconds + 's')
        .join(', ')
    })
    enter = () => write(toCss)
    leave = () => write(fromCss)
  } else {
    const animation = element.animate([keyframeFrom(fromVars), keyframeFrom(toVars)], timing)
    animation.pause()
    if (repeatCount === 0) {
      animation.addEventListener('finish', () => {
        if (animation.playbackRate > 0) {
          settleOn(element, toVars)
          if (once || trigger === 'load') {
            animation.cancel()
          }
        }
      })
    }
    enter = () => {
      animation.playbackRate = 1
      animation.play()
    }
    leave = () => {
      animation.playbackRate = -1
      animation.play()
    }
  }
  markReady()

  if (trigger === 'load') {
    window.requestAnimationFrame(() => enter())
    return
  }

  // In view: the observer asks, and a standing scroll check answers with the
  // same threshold, so a missed observer callback can never trap content hidden.
  let revealed = false
  let frame = 0
  let observer = null
  const check = () => {
    if (once && revealed) {
      return
    }
    const rect = element.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight || 0
    const vw = window.innerWidth || document.documentElement.clientWidth || 0
    const fraction = visibleFraction(rect, vh, vw)
    const threshold = Math.min(amount, reachableFraction(rect, vh, vw) * 0.9)
    const visible = fraction > 0 && fraction >= threshold
    if (visible === revealed) {
      return
    }
    revealed = visible
    if (visible) {
      enter()
      if (once) {
        window.removeEventListener('scroll', schedule)
        window.removeEventListener('resize', schedule)
        if (observer) {
          observer.disconnect()
        }
      }
    } else {
      leave()
    }
  }
  const schedule = () => {
    if (frame) {
      return
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0
      check()
    })
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(schedule, { threshold: [0, Math.min(1, amount)] })
    observer.observe(element)
  }
  schedule()
}

whenParsed(() => {
  document.querySelectorAll('[${MOTION_MARKER_ATTR}]').forEach((element) => {
    try {
      initMotion(element)
    } catch (e) {
      // never leave content hidden behind a broken animation
      element.setAttribute(READY_ATTR, '')
    }
  })
})
})()`

const videoModule = (): string => `;(function () {
${PROGRESS_SOURCE}

${MotionRuntime.scrollVideoEngineSource()}

const initVideo = (host) => {
  const streamed = host.querySelector(':scope > video')
  if (!streamed) {
    return
  }
  // The element on screen: the streamed one until the held clip takes over.
  let video = streamed
  let hold = null
  const text = (name, fallback) => {
    const value = host.getAttribute('data-scroll-video-' + name)
    return value === null || value === '' ? fallback : value
  }
  const src = text('src', '')
  const mobileSrc = text('mobile-src', '')
  const useMobile =
    mobileSrc &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches
  const activeSrc = useMobile ? mobileSrc : src
  if (!activeSrc) {
    return
  }
  if (streamed.getAttribute('src') !== activeSrc) {
    streamed.setAttribute('src', activeSrc)
  }
  const smoothing = Number(text('smoothing', '0.2')) || 0
  const bounds = normalizeWindow(text('window-start', '0'), text('window-end', '100'))
  let lastClip = -1
  let pendingClip = 0

  const seekTo = (clipProgress) => {
    pendingClip = clipProgress
    // the held clip hears where the scrub is before any metadata has arrived
    if (hold) {
      hold.want(clipProgress)
    }
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

  if (prefersReducedMotion()) {
    // 'poster': never seek, the poster keeps painting until a seek happens.
    if (text('reduced-motion', 'poster') === 'end') {
      seekTo(1)
    }
    return
  }
  hold = holdClip(host, streamed, activeSrc, (copy) => {
    video = copy
    onMetadata()
  })

  const backToStart = text('back-to-start', 'false') === 'true'
  const driveTo = (drivingProgress) => {
    const local = (clamp01(drivingProgress) * 100 - bounds.start) / (bounds.end - bounds.start)
    seekTo(clipPositionFor(local, backToStart))
  }
  // Inside a scene the clip follows the scene's track; pinned when the stage is sticky.
  const sceneTrack = host.closest('[data-scene-track]')
  const measured = sceneTrack || host
  const stage = sceneTrack ? sceneTrack.querySelector(':scope > [data-scene-stage]') : null
  const offset =
    sceneTrack && stage && window.getComputedStyle(stage).position === 'sticky'
      ? 'contained'
      : 'pass'
  const measure = () =>
    progressForRect(measured.getBoundingClientRect(), window.innerHeight || 1, offset)
  driveTo(measure())
  followProgress(measure, smoothing, driveTo)
}

whenParsed(() => {
  document.querySelectorAll('[data-scroll-video]').forEach((host) => {
    try {
      initVideo(host)
    } catch (e) {
      // a clip that cannot scrub keeps showing its poster
    }
  })
})
})()`

export interface MotionRuntimeUsage {
  scenes: boolean
  motion: boolean
  video: boolean
}

/**
 * The shared sources carry the notes of the people who maintain them. A visitor's
 * browser has no use for those, so whole-line comments stay out of the shipped
 * file (the sources hold no multi-line strings a line filter could cut into).
 */
const withoutCommentLines = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

export const motionRuntimeScript = (usage: MotionRuntimeUsage): string =>
  [
    '/* TeleportHQ motion runtime: scroll scenes, element motion and scroll video for this static site. */',
    `window.${RUNTIME_FLAG} = true`,
    withoutCommentLines(
      [
        usage.scenes ? sceneModule() : '',
        usage.video ? videoModule() : '',
        usage.motion ? motionModule() : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    ),
  ].join('\n\n') + '\n'
