import { PageTransition } from '@teleporthq/teleport-shared'

/**
 * A site's page transition, for a static HTML export: cross-document View
 * Transitions, which the browser plays between two ordinary pages with no
 * script driving it.
 *
 * The states are not written here. They come from the same registry the Next
 * export's TqPageTransition is generated from (teleport-shared), evaluated once
 * at generation time, so a preset looks the same in both exports and a new
 * preset reaches both. What differs is only who plays them:
 *
 *   Next   AnimatePresence, mode "wait": the leaving page runs its exit, then
 *          the arriving page runs initial → animate.
 *   HTML   the browser holds a picture of the leaving page and one of the
 *          arriving page; the first animates over [0, D], the second waits D
 *          and animates over [D, 2D]. Same order, same timing.
 *
 * A browser without the feature (Firefox today) simply navigates, which is
 * also what a visitor who asked for less motion gets.
 */

type State = Record<string, unknown>

export const BACK_ATTR = 'data-tq-nav'
export const ORIGIN_X = '--tq-origin-x'
export const ORIGIN_Y = '--tq-origin-y'

const hasAny = (state: State, keys: string[]): boolean =>
  keys.some((key) => state[key] !== undefined)

/** One keyframe. Both ends of an animation declare the same properties, so every one of them interpolates. */
const declarations = (state: State, other: State): string[] => {
  const lines: string[] = []
  const both = (keys: string[]) => hasAny(state, keys) || hasAny(other, keys)
  if (both(['opacity'])) {
    lines.push(`opacity: ${state.opacity ?? 1};`)
  }
  if (both(['x', 'y', 'scale'])) {
    lines.push(
      `transform: translate(${state.x ?? 0}px, ${state.y ?? 0}px) scale(${state.scale ?? 1});`
    )
  }
  if (both(['filter'])) {
    lines.push(`filter: ${state.filter ?? 'blur(0px)'};`)
  }
  if (both(['clipPath'])) {
    lines.push(`clip-path: ${state.clipPath ?? 'inset(0 0 0 0)'};`)
  }
  return lines
}

const keyframes = (name: string, from: State, to: State): string =>
  `@keyframes ${name} {\n  from { ${declarations(from, to).join(' ')} }\n  to { ${declarations(
    to,
    from
  ).join(' ')} }\n}`

/**
 * The cover family in the Next export is one or two coloured panels that close
 * over the leaving page and open on the arriving one. A picture of a page can
 * be clipped, so here the panel is what shows where the picture is clipped
 * away: the colour sits behind both pictures and the clip edge is the panel's
 * leading edge. Same sweep, same colour, no extra element on any page.
 */
const COVER_CLIPS: Record<string, { covered: string; opening: string }> = {
  // one panel rising from the bottom, then leaving through the top
  cover: { covered: 'inset(0 0 100% 0)', opening: 'inset(100% 0 0 0)' },
  // two panels meeting in the middle, then parting
  curtain: { covered: 'inset(0 50% 0 50%)', opening: 'inset(0 50% 0 50%)' },
}
const OPEN = 'inset(0 0 0 0)'

interface Animations {
  leave: [State, State]
  arrive: [State, State]
}

const animationsFor = (
  preset: string,
  context: PageTransition.PageTransitionContext,
  options: Record<string, string>,
  custom: PageTransition.PageTransitionCustom | undefined
): Animations | null => {
  const cover = COVER_CLIPS[preset]
  if (cover) {
    return {
      leave: [{ clipPath: OPEN }, { clipPath: cover.covered }],
      arrive: [{ clipPath: cover.opening }, { clipPath: OPEN }],
    }
  }
  const variants = PageTransition.pageTransitionVariants(
    preset,
    PageTransition.PAGE_TRANSITION_SLIDE_PX,
    context,
    options,
    custom
  )
  if (!variants) {
    return null
  }
  return {
    leave: [variants.animate, variants.exit],
    arrive: [variants.initial, variants.animate],
  }
}

export interface ViewTransitionPlan {
  css: string
  /** The back button plays a different preset, so the page has to tell the stylesheet which way it came. */
  needsDirection: boolean
  /** The reveal grows from where the visitor pressed, so the page has to hand that point over. */
  needsOrigin: boolean
}

export const viewTransitionPlan = (
  config: PageTransition.PageTransitionConfig
): ViewTransitionPlan | null => {
  const preset = String(config.preset).replace(/[^a-z-]/g, '')
  const chosen =
    config.options && typeof config.options === 'object'
      ? Object.fromEntries(
          Object.entries(config.options).filter(([, value]) => typeof value === 'string')
        )
      : undefined
  const options = PageTransition.resolvePageTransitionOptions(preset, chosen)
  const duration = Number.isFinite(config.duration) && config.duration > 0 ? config.duration : 0.35
  const curve =
    PageTransition.PAGE_TRANSITION_EASING_CURVES[config.easing] ||
    PageTransition.PAGE_TRANSITION_EASING_CURVES['ease-out']
  const custom =
    preset === 'custom'
      ? PageTransition.sanitizePageTransitionCustom({
          durationSeconds: duration,
          easing: config.easing,
          arrive: config.custom?.arrive as never,
          leave: config.custom?.leave as never,
        })
      : undefined

  const needsOrigin = preset === 'circle' && options.origin !== 'center'
  const origin = needsOrigin
    ? { originX: `var(${ORIGIN_X}, 50%)`, originY: `var(${ORIGIN_Y}, 50%)` }
    : { originX: '50%', originY: '50%' }
  const forward = animationsFor(preset, { reverse: false, ...origin }, options, custom)
  if (!forward) {
    return null
  }
  const needsDirection = PageTransition.reversePageTransitionPreset(preset) !== preset
  const back = needsDirection
    ? animationsFor(preset, { reverse: true, originX: '50%', originY: '50%' }, options, custom)
    : null

  const timing = `${duration}s cubic-bezier(${curve.join(', ')})`
  const rules = [
    '@view-transition {\n  navigation: auto;\n}',
    '::view-transition-old(root),\n::view-transition-new(root) {\n  mix-blend-mode: normal;\n}',
    `::view-transition-old(root) {\n  animation: tq-page-leave ${timing} both;\n}`,
    `::view-transition-new(root) {\n  animation: tq-page-arrive ${timing} ${duration}s both;\n}`,
    keyframes('tq-page-leave', forward.leave[0], forward.leave[1]),
    keyframes('tq-page-arrive', forward.arrive[0], forward.arrive[1]),
  ]
  if (COVER_CLIPS[preset]) {
    rules.push(
      `::view-transition-group(root) {\n  background: ${PageTransition.pageTransitionCoverColor(
        options.color
      )};\n}`
    )
  }
  if (back) {
    rules.push(
      `html[${BACK_ATTR}="back"]::view-transition-old(root) {\n  animation-name: tq-page-leave-back;\n}`,
      `html[${BACK_ATTR}="back"]::view-transition-new(root) {\n  animation-name: tq-page-arrive-back;\n}`,
      keyframes('tq-page-leave-back', back.leave[0], back.leave[1]),
      keyframes('tq-page-arrive-back', back.arrive[0], back.arrive[1])
    )
  }
  const indented = rules.map((rule) => rule.replace(/^/gm, '  ')).join('\n')
  return {
    css: `@media (prefers-reduced-motion: no-preference) {\n${indented}\n}\n`,
    needsDirection,
    needsOrigin,
  }
}
