/**
 * The three states of a route transition for a preset, and the preset the
 * back button plays. Mirrored VERBATIM from teleport-gui's
 * `constants/primitives/page-transition.ts` — the settings picker demonstrates
 * these exact states. Plain JS inside the bodies on purpose: their compiled
 * source is injected into the generated `TqPageTransition` wrapper with
 * `toString()`, so no template literals, no backticks, no helpers from outside
 * the two functions.
 */
export interface PageTransitionContext {
  reverse: boolean
  originX: string
  originY: string
}

export interface PageTransitionPanel {
  from: Record<string, unknown>
  cover: Record<string, unknown>
  away: Record<string, unknown>
  side?: 'left' | 'right'
}

export interface PageTransitionVariants {
  initial: Record<string, unknown>
  animate: Record<string, unknown>
  exit: Record<string, unknown>
}

export function reversePageTransitionPreset(preset: string): string {
  const pairs: Record<string, string> = {
    'slide-up': 'slide-down',
    'slide-down': 'slide-up',
    'slide-left': 'slide-right',
    'slide-right': 'slide-left',
    'zoom-in': 'zoom-out',
    'zoom-out': 'zoom-in',
    'wipe-down': 'wipe-up',
    'wipe-up': 'wipe-down',
    'wipe-left': 'wipe-right',
    'wipe-right': 'wipe-left',
    stack: 'unstack',
    unstack: 'stack',
  }
  return pairs[preset] || preset
}

export interface PageTransitionCustomState {
  opacity: number
  x: number
  y: number
  scale: number
  blur: number
}

export interface PageTransitionCustom {
  durationSeconds: number
  easing: string
  arrive: PageTransitionCustomState
  leave: PageTransitionCustomState
}

export function pageTransitionVariants(
  preset: string,
  slidePx: number,
  context?: PageTransitionContext,
  options?: Record<string, string>,
  custom?: PageTransitionCustom
): PageTransitionVariants | null {
  const reverse = context ? context.reverse : false
  const originX = context ? context.originX : '50%'
  const originY = context ? context.originY : '50%'
  const name = reverse ? reversePageTransitionPreset(preset) : preset
  const bold = options
    ? options.distance === 'bold' || options.depth === 'bold' || options.amount === 'bold'
    : false
  const near = bold ? slidePx * 4 : slidePx
  const far = near * 2
  const blurPx = options && options.softness === 'heavy' ? 28 : 12
  const shrink = bold ? 0.85 : 0.94
  const zoomOut = bold ? 0.85 : 0.96
  const zoomIn = bold ? 1.15 : 1.04
  if (name === 'custom') {
    // Neutral in the middle; the two ends are exactly the user's values.
    const c = custom || {
      arrive: { opacity: 0, x: 0, y: 24, scale: 1, blur: 0 },
      leave: { opacity: 0, x: 0, y: -24, scale: 1, blur: 0 },
    }
    return {
      initial: {
        opacity: c.arrive.opacity,
        x: c.arrive.x,
        y: c.arrive.y,
        scale: c.arrive.scale,
        filter: 'blur(' + c.arrive.blur + 'px)',
      },
      animate: { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' },
      exit: {
        opacity: c.leave.opacity,
        x: c.leave.x,
        y: c.leave.y,
        scale: c.leave.scale,
        filter: 'blur(' + c.leave.blur + 'px)',
      },
    }
  }
  if (name === 'fade') {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
  }
  if (name === 'crossfade') {
    return {
      initial: { opacity: 0, scale: 1.02 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.98 },
    }
  }
  if (name === 'blur') {
    return {
      initial: { opacity: 0, filter: 'blur(' + blurPx + 'px)' },
      animate: { opacity: 1, filter: 'blur(0px)' },
      exit: { opacity: 0, filter: 'blur(' + blurPx + 'px)' },
    }
  }
  if (name === 'slide-up') {
    return {
      initial: { opacity: 0, y: near },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -near },
    }
  }
  if (name === 'slide-down') {
    return {
      initial: { opacity: 0, y: -near },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: near },
    }
  }
  if (name === 'slide-left') {
    return {
      initial: { opacity: 0, x: far },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -far },
    }
  }
  if (name === 'slide-right') {
    return {
      initial: { opacity: 0, x: -far },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: far },
    }
  }
  if (name === 'stack') {
    return {
      initial: { opacity: 0, y: far },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, scale: shrink },
    }
  }
  if (name === 'unstack') {
    return {
      initial: { opacity: 0, scale: shrink },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, y: far },
    }
  }
  if (name === 'zoom-in') {
    return {
      initial: { opacity: 0, scale: zoomOut },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: zoomIn },
    }
  }
  if (name === 'zoom-out') {
    return {
      initial: { opacity: 0, scale: zoomIn },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: zoomOut },
    }
  }
  if (name === 'wipe-down') {
    return {
      initial: { clipPath: 'inset(0 0 100% 0)' },
      animate: { clipPath: 'inset(0 0 0% 0)' },
      exit: { clipPath: 'inset(100% 0 0 0)' },
    }
  }
  if (name === 'wipe-up') {
    return {
      initial: { clipPath: 'inset(100% 0 0 0)' },
      animate: { clipPath: 'inset(0% 0 0 0)' },
      exit: { clipPath: 'inset(0 0 100% 0)' },
    }
  }
  if (name === 'wipe-left') {
    return {
      initial: { clipPath: 'inset(0 0 0 100%)' },
      animate: { clipPath: 'inset(0 0 0 0%)' },
      exit: { clipPath: 'inset(0 100% 0 0)' },
    }
  }
  if (name === 'wipe-right') {
    return {
      initial: { clipPath: 'inset(0 100% 0 0)' },
      animate: { clipPath: 'inset(0 0% 0 0)' },
      exit: { clipPath: 'inset(0 0 0 100%)' },
    }
  }
  if (name === 'circle') {
    const at = ' at ' + originX + ' ' + originY + ')'
    return {
      initial: { clipPath: 'circle(0%' + at },
      animate: { clipPath: 'circle(150%' + at },
      exit: { clipPath: 'circle(0%' + at },
    }
  }
  if (name === 'cover' || name === 'curtain') {
    // The panels do the work; the page itself only has to STAY while it is
    // being covered. An exit that changes nothing would end instantly, so it
    // moves opacity by an invisible amount — that is what keeps the leaving
    // page on screen for exactly one panel sweep.
    return { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 0.999 } }
  }
  return null
}

export function pageTransitionCover(preset: string): PageTransitionPanel[] | null {
  if (preset === 'cover') {
    return [{ from: { y: '100%' }, cover: { y: '0%' }, away: { y: '-100%' } }]
  }
  if (preset === 'curtain') {
    return [
      { from: { x: '-100%' }, cover: { x: '0%' }, away: { x: '-100%' }, side: 'left' },
      { from: { x: '100%' }, cover: { x: '0%' }, away: { x: '100%' }, side: 'right' },
    ]
  }
  return null
}

/**
 * The matcher for a route a page opted out of transitions with: exact path,
 * optional trailing slash, and `[param]` segments (how the editor spells a
 * details page) matching any single segment. Injected into the wrapper.
 */
export function pageTransitionSkipPattern(route: string): RegExp {
  const escaped = route.replace(/[.*+?^$()|{}\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/\[[^\]]+\]/g, '[^/]+') + '/?$')
}

/** How far a page travels while sliding, in px — pages move, they do not fly. */
export const PAGE_TRANSITION_SLIDE_PX = 24

/**
 * The preset's choices with gaps filled by defaults and unknown words replaced
 * by the default. Mirrored verbatim from teleport-gui; runs at generation time.
 */
export function resolvePageTransitionOptions(
  preset: string,
  chosen?: Record<string, string>
): Record<string, string> {
  const catalog: Record<string, Array<[string, string[]]>> = {
    blur: [['softness', ['light', 'heavy']]],
    'slide-up': [['distance', ['subtle', 'bold']]],
    'slide-down': [['distance', ['subtle', 'bold']]],
    'slide-left': [['distance', ['subtle', 'bold']]],
    'slide-right': [['distance', ['subtle', 'bold']]],
    stack: [['depth', ['subtle', 'bold']]],
    'zoom-in': [['amount', ['subtle', 'bold']]],
    'zoom-out': [['amount', ['subtle', 'bold']]],
    circle: [['origin', ['click', 'center']]],
    cover: [['color', ['brand', 'dark', 'light']]],
    curtain: [['color', ['brand', 'dark', 'light']]],
  }
  const resolved: Record<string, string> = {}
  const entries = catalog[preset] || []
  for (let i = 0; i < entries.length; i++) {
    const key = entries[i][0]
    const words = entries[i][1]
    const value = chosen ? chosen[key] : undefined
    const known =
      value !== undefined &&
      (words.indexOf(value) >= 0 || (key === 'color' && isPageTransitionColorValue(value)))
    resolved[key] = known ? (value as string) : words[0]
  }
  return resolved
}

/**
 * A colour a cover panel may carry: a project token id, a hex colour, or
 * rgb/hsl with plain numbers — the value lands verbatim in generated code.
 * Mirrored verbatim from teleport-gui.
 */
export function isPageTransitionColorValue(value: string | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) {
    return false
  }
  return (
    /^token:[a-z0-9_-]+$/i.test(value) ||
    /^--[a-z0-9_-]+$/i.test(value) ||
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(value)
  )
}

/** The CSS colour a cover-family panel paints with: token → var(), literal as is, words → theme tokens. Mirrored verbatim from teleport-gui. */
export function pageTransitionCoverColor(color: string | undefined): string {
  const dark = 'var(--dl-color-theme-neutral-dark, #111111)'
  if (color === 'dark') {
    return dark
  }
  if (color === 'light') {
    return 'var(--dl-color-theme-neutral-light, #ffffff)'
  }
  if (
    color &&
    color !== 'brand' &&
    color.indexOf('token:') !== 0 &&
    isPageTransitionColorValue(color)
  ) {
    return color.indexOf('--') === 0 ? 'var(' + color + ', ' + dark + ')' : color
  }
  return 'var(--dl-color-theme-primary1, ' + dark + ')'
}

const CUSTOM_EASINGS = [
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'spring',
  'back',
  'bounce',
]

const DEFAULT_CUSTOM: PageTransitionCustom = {
  durationSeconds: 0.35,
  easing: 'ease-out',
  arrive: { opacity: 0, x: 0, y: 24, scale: 1, blur: 0 },
  leave: { opacity: 0, x: 0, y: -24, scale: 1, blur: 0 },
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

const sanitizeCustomState = (
  input: Partial<PageTransitionCustomState> | undefined,
  fallback: PageTransitionCustomState
): PageTransitionCustomState => ({
  opacity: clamp(input?.opacity, 0, 1, fallback.opacity),
  x: clamp(input?.x, -400, 400, fallback.x),
  y: clamp(input?.y, -400, 400, fallback.y),
  scale: clamp(input?.scale, 0.25, 2, fallback.scale),
  blur: clamp(input?.blur, 0, 60, fallback.blur),
})

/** Every custom value inside its range and a known easing; mirrored verbatim from teleport-gui. Runs at generation time. */
export function sanitizePageTransitionCustom(
  input: Partial<PageTransitionCustom> | undefined
): PageTransitionCustom {
  const easing =
    typeof input?.easing === 'string' && CUSTOM_EASINGS.indexOf(input.easing) >= 0
      ? input.easing
      : DEFAULT_CUSTOM.easing
  return {
    durationSeconds: clamp(input?.durationSeconds, 0.05, 3, DEFAULT_CUSTOM.durationSeconds),
    easing,
    arrive: sanitizeCustomState(input?.arrive, DEFAULT_CUSTOM.arrive),
    leave: sanitizeCustomState(input?.leave, DEFAULT_CUSTOM.leave),
  }
}

/** What the editor exports under `globals.settings.pageTransition`. */
export interface PageTransitionConfig {
  preset: string
  duration: number
  easing: string
  skipRoutes?: string[]
  options?: Record<string, string>
  custom?: { arrive?: Record<string, number>; leave?: Record<string, number> }
  /** False when the author turned the flying pictures off; absent means they fly. */
  flyingPictures?: boolean
}

/** The same curves the motion widget plays, so a route transition shares the site's motion character. */
export const PAGE_TRANSITION_EASING_CURVES: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  spring: [0.34, 1.56, 0.64, 1],
  back: [0.68, -0.6, 0.32, 1.6],
  bounce: [0.22, 1.2, 0.36, 1],
}

/** The resolved transition the editor exported, or null when pages switch instantly. */
export const projectPageTransition = (uidl: {
  globals?: { settings?: unknown }
}): PageTransitionConfig | null => {
  const settings = (uidl.globals?.settings || {}) as { pageTransition?: PageTransitionConfig }
  const transition = settings.pageTransition
  if (!transition || !transition.preset || transition.preset === 'none') {
    return null
  }
  return transition
}
