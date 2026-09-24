/**
 * The scroll-scene lane engine as SOURCE TEXT: the constants, the lane presets
 * and the functions that parse a `data-scroll-bind`, read a lane at a progress
 * and write it onto an element. It is plain DOM JavaScript with no framework in
 * it, which is why two runtimes can share it word for word:
 *
 *   - the Next export wraps it in the TqScrollScene React component, where
 *     framer-motion supplies the scroll progress;
 *   - the HTML export wraps it in a small vanilla controller, where a scroll
 *     listener supplies the same progress.
 *
 * One copy means a new lane property or preset reaches both exports at once.
 * The text mirrors the canvas renderer's scroll-scene-lanes module, so the
 * canvas, the Next site and the HTML site move identically. (No backticks in
 * the engine's own comments: it is a template literal.)
 */
import { settledMomentForLanes } from './moment'
import { activeChapterIndex } from './chapter-index'
import { passedScenePoints, scenePointList, scenePointRank } from './points'
import { unclipStickyAncestors } from './unclip'

export const scrollSceneEngineSource = (): string => `const SCROLL_BIND_ATTR = 'data-scroll-bind'
// A chapter coming on stage is announced on the chapter element (bubbling), so
// a workflow trigger bound to the chapter can listen without knowing the scene.
const CHAPTER_REACHED_EVENT = 'tq-chapter-reached'
const CHAPTER_ACTIVE_ATTR = 'data-chapter-active'
const CHAPTER_COUNT_ATTR = 'data-chapter-count'
// Scrolling DOWN past a quarter / halfway / three quarters / the end of the
// scene is announced on the track (the element with the scene's id), bubbling;
// the furthest point passed so far is stamped for listeners that attach later.
const SCENE_POINT_EVENT = 'tq-scene-point-passed'
const SCENE_POINT_ATTR = 'data-scene-point'

const LANE_PROPS = [
  'x',
  'y',
  'scale',
  'rotate',
  'rotate-x',
  'rotate-y',
  'opacity',
  'blur',
  'grayscale',
  'saturate',
  'brightness',
  'clip',
  'clip-y',
  'count',
]

// Mirrors SCROLL_COUNT_ATTR / SCROLL_COUNT_CSS in the editor's lane contract.
const COUNT_ATTR = 'data-scroll-count'
const HIDDEN_ATTR = 'data-scene-hidden'
const HIDDEN_CSS =
  '[data-scene-hidden], [data-scene-hidden] * { pointer-events: none !important; }'
const COUNT_CSS =
  '[data-scroll-count]::before { counter-reset: tq-count var(--tq-count, 0); content: counter(tq-count); }'
const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(value * 100) / 100))

const LANE_PRESETS = {
  'depth-1': [{ prop: 'y', at: [0, 1], values: [40, -40] }],
  'depth-2': [{ prop: 'y', at: [0, 1], values: [80, -80] }],
  'depth-3': [{ prop: 'y', at: [0, 1], values: [140, -140] }],
  'fade-window': [{ prop: 'opacity', at: [0, 0.15, 0.85, 1], values: [0, 1, 1, 0] }],
  'rail-x': [{ prop: 'x', at: [0, 1], values: [0, -100], unit: '%' }],
  'zoom-through': [{ prop: 'scale', at: [0, 1], values: [0.85, 1.1] }],
  'unblur-in': [{ prop: 'blur', at: [0, 0.3], values: [10, 0] }],
  'rise-in': [
    { prop: 'y', at: [0, 0.35], values: [70, 0] },
    { prop: 'opacity', at: [0, 0.3], values: [0, 1] },
  ],
  'ghost-out': [
    { prop: 'opacity', at: [0.7, 1], values: [1, 0] },
    { prop: 'blur', at: [0.7, 1], values: [0, 8] },
  ],
  'color-in': [{ prop: 'grayscale', at: [0, 0.45], values: [1, 0] }],
  'sun-up': [{ prop: 'brightness', at: [0, 0.4], values: [0.35, 1] }],
  'fade-to-mono': [
    { prop: 'grayscale', at: [0.6, 1], values: [0, 1] },
    { prop: 'saturate', at: [0.6, 1], values: [1, 0.6] },
  ],
  'crash-zoom': [
    { prop: 'scale', at: [0, 0.25], values: [1.6, 1] },
    { prop: 'opacity', at: [0, 0.15], values: [0, 1] },
  ],
  'tilt-reveal': [
    { prop: 'rotate-x', at: [0, 0.4], values: [35, 0] },
    { prop: 'opacity', at: [0, 0.3], values: [0, 1] },
  ],
  'spin-in': [
    { prop: 'rotate', at: [0, 0.35], values: [-90, 0] },
    { prop: 'opacity', at: [0, 0.25], values: [0, 1] },
  ],
  breathe: [{ prop: 'scale', at: [0, 0.5, 1], values: [0.98, 1.03, 0.98] }],
}

const isValidLane = (lane) => {
  if (!lane || typeof lane !== 'object' || !LANE_PROPS.includes(lane.prop)) {
    return false
  }
  if (!Array.isArray(lane.at) || !Array.isArray(lane.values)) {
    return false
  }
  if (lane.at.length < 2 || lane.at.length !== lane.values.length) {
    return false
  }
  const numbers = (list) => list.every((entry) => typeof entry === 'number' && isFinite(entry))
  if (!numbers(lane.at) || !numbers(lane.values)) {
    return false
  }
  for (let index = 1; index < lane.at.length; index++) {
    if (lane.at[index] < lane.at[index - 1]) {
      return false
    }
  }
  return lane.unit === undefined || lane.unit === 'px' || lane.unit === '%' || lane.unit === 'vw'
}

${settledMomentForLanes.toString()}

${activeChapterIndex.toString()}

${scenePointList.toString()}

${passedScenePoints.toString()}

${scenePointRank.toString()}

${unclipStickyAncestors.toString()}

const parseScrollBind = (value) => {
  const raw = String(value || '').trim()
  if (!raw) {
    return []
  }
  if (LANE_PRESETS[raw]) {
    return LANE_PRESETS[raw].map((lane) => ({ ...lane }))
  }
  if (!raw.startsWith('[')) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidLane) : []
  } catch (e) {
    return []
  }
}

const laneValueAt = (lane, p) => {
  const at = lane.at
  const values = lane.values
  if (p <= at[0]) {
    return values[0]
  }
  if (p >= at[at.length - 1]) {
    return values[values.length - 1]
  }
  for (let index = 1; index < at.length; index++) {
    if (p <= at[index]) {
      const span = at[index] - at[index - 1]
      const local = span === 0 ? 1 : (p - at[index - 1]) / span
      return values[index - 1] + (values[index] - values[index - 1]) * local
    }
  }
  return values[values.length - 1]
}

const FILTER_PROP_ORDER = ['blur', 'grayscale', 'saturate', 'brightness']

// Motion lanes write the INDIVIDUAL transform properties (translate / scale /
// rotate) and never the transform property itself: the browser composes them
// with whatever the author put in transform (a translateX(-50%) centering, a
// tilt), so the scene never clobbers the user's own layout. 3D lanes use the
// axis form of rotate; the stage supplies the vanishing point. Mirrors the
// canvas. (No backticks in this file's comments — it is a template literal.)
const applyLanesAt = (element, lanes, p) => {
  const filterByProp = {}
  let translateX
  let translateY
  let rotate
  let scale
  for (const lane of lanes) {
    const value = laneValueAt(lane, p)
    switch (lane.prop) {
      case 'x':
        translateX = value + (lane.unit || 'px')
        break
      case 'y':
        translateY = value + (lane.unit || 'px')
        break
      case 'scale':
        scale = String(value)
        break
      case 'rotate':
        rotate = rotate === undefined ? value + 'deg' : rotate
        break
      case 'rotate-x':
        rotate = 'x ' + value + 'deg'
        break
      case 'rotate-y':
        rotate = 'y ' + value + 'deg'
        break
      case 'opacity':
        element.style.opacity = String(value)
        // A faded-out element must not swallow clicks (stacked chapters: the
        // invisible top one would take every tap meant for the visible story).
        // Attribute + CSS rule, never inline pointer-events, so lanes cannot
        // overwrite a pointer-events the author set. Mirrors the editor.
        if (value <= 0.02) {
          element.setAttribute(HIDDEN_ATTR, '')
        } else {
          element.removeAttribute(HIDDEN_ATTR)
        }
        break
      case 'blur':
        filterByProp.blur = 'blur(' + value + 'px)'
        break
      case 'grayscale':
        filterByProp.grayscale = 'grayscale(' + value + ')'
        break
      case 'saturate':
        filterByProp.saturate = 'saturate(' + value + ')'
        break
      case 'brightness':
        filterByProp.brightness = 'brightness(' + value + ')'
        break
      case 'clip':
        element.style.clipPath = 'inset(0 ' + clampPercent(100 - value) + '% 0 0)'
        break
      case 'clip-y':
        element.style.clipPath = 'inset(0 0 ' + clampPercent(100 - value) + '% 0)'
        break
      case 'count':
        element.style.setProperty('--tq-count', String(Math.round(value)))
        if (!element.hasAttribute(COUNT_ATTR)) {
          element.setAttribute(COUNT_ATTR, '')
        }
        break
    }
  }
  if (translateX !== undefined || translateY !== undefined) {
    element.style.translate = (translateX || '0px') + ' ' + (translateY || '0px')
  }
  if (scale !== undefined) {
    element.style.scale = scale
  }
  if (rotate !== undefined) {
    element.style.rotate = rotate
  }
  const filterParts = FILTER_PROP_ORDER.map((prop) => filterByProp[prop]).filter(Boolean)
  if (filterParts.length > 0) {
    element.style.filter = filterParts.join(' ')
  }
}

const collectBound = (track) => {
  const bound = []
  track.querySelectorAll('[' + SCROLL_BIND_ATTR + ']').forEach((element) => {
    const lanes = parseScrollBind(element.getAttribute(SCROLL_BIND_ATTR))
    if (lanes.length > 0) {
      bound.push({ element, lanes })
    }
  })
  return bound
}

const normalizeSceneLength = (value) => {
  const match = /^(\\d{2,4})vh$/.exec(String(value || '').trim())
  if (!match) {
    return '300vh'
  }
  // Hard safety bound only — the editor owns the story-sized soft cap.
  return Math.min(4000, Math.max(100, Number(match[1]))) + 'vh'
}`
