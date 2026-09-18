/**
 * The names the static HTML export's motion markup, stylesheet and runtime
 * agree on. The scene's own names (`data-scene-track`, `data-scene-stage`,
 * `data-scroll-video`, `data-scroll-bind`) are the ones the Next export's
 * widgets stamp, so a selector written against one export holds in the other.
 */

/** Set on <html> by a one-line head script: "this page will be animated". */
export const PAGE_FLAG_ATTR = 'data-tq-motion-on'
/** Set on window by the runtime; the head script's failsafe reads it. */
export const RUNTIME_FLAG = '__tqMotionRuntime'
/** How long the page waits for the runtime before showing everything as it is. */
export const RUNTIME_FAILSAFE_MS = 4000

export const MOTION_MARKER_ATTR = 'data-tq-motion'
export const MOTION_READY_ATTR = 'data-motion-ready'

export const SCENE_TRACK_ATTR = 'data-scene-track'
export const SCENE_STAGE_ATTR = 'data-scene-stage'
export const SCENE_LAYOUT_ATTR = 'data-scene-layout'
export const SCENE_LENGTH_ATTR = 'data-scene-length'
export const SCENE_PIN_ATTR = 'data-scene-pin'

export const SCROLL_VIDEO_ATTR = 'data-scroll-video'

export const MOTION_RUNTIME_FILE_NAME = 'tq-motion'

/** Exported wrapper prop → the attribute the runtime reads. */
export const SCENE_ATTR_BY_PROP: Record<string, string> = {
  sceneLength: SCENE_LENGTH_ATTR,
  pin: SCENE_PIN_ATTR,
  scrub: 'data-scene-scrub',
  reducedMotion: 'data-scene-reduced-motion',
  exposeProgress: 'data-scene-expose-progress',
  chapterSnap: 'data-scene-chapter-snap',
}

export const MOTION_ATTR_BY_PROP: Record<string, string> = {
  preset: 'data-motion-preset',
  trigger: 'data-motion-trigger',
  duration: 'data-motion-duration',
  delay: 'data-motion-delay',
  easing: 'data-motion-easing',
  repeat: 'data-motion-repeat',
  repeatType: 'data-motion-repeat-type',
  inViewOnce: 'data-motion-in-view-once',
  inViewAmount: 'data-motion-in-view-amount',
  stagger: 'data-motion-stagger',
  distance: 'data-motion-distance',
  from: 'data-motion-from',
  to: 'data-motion-to',
  scrub: 'data-motion-scrub',
  scrollOffset: 'data-motion-scroll-offset',
}

export const SCROLL_VIDEO_ATTR_BY_PROP: Record<string, string> = {
  src: 'data-scroll-video-src',
  poster: 'data-scroll-video-poster',
  mobileSrc: 'data-scroll-video-mobile-src',
  smoothing: 'data-scroll-video-smoothing',
  windowStart: 'data-scroll-video-window-start',
  windowEnd: 'data-scroll-video-window-end',
  reducedMotion: 'data-scroll-video-reduced-motion',
  backToStart: 'data-scroll-video-back-to-start',
}

export const SCENE_ELEMENT_TYPE = 'scroll-scene-node'
export const MOTION_ELEMENT_TYPE = 'motion-node'
export const SCROLL_VIDEO_ELEMENT_TYPE = 'scroll-video-node'

/** Hard safety bound of a scene's length, the same one the runtime engine applies. */
export const normalizeSceneLength = (value: unknown): string => {
  const match = /^(\d{2,4})vh$/.exec(String(value ?? '').trim())
  if (!match) {
    return '300vh'
  }
  return `${Math.min(4000, Math.max(100, Number(match[1])))}vh`
}
