import type { PageTransitionVariants } from './page-transition-variants'

// Object.assign, not a spread: this package compiles to ES5, where a spread
// becomes a call to tsc's `__assign` helper — outside the function, so missing
// from the source injected into the generated component.
/* tslint:disable:prefer-object-spread */

/** The screen a page change starts on, measured at `routeChangeStart`. */
export interface PageTransitionScreen {
  width: number
  height: number
}

/**
 * A reveal's clip (Circle, the Wipes) measured on the SCREEN, played over the
 * leaving page, and dropped once the page has settled. Injected into
 * `components/tq-page-transition.js` with `toString()`: plain JS in the body,
 * nothing from outside it, no backticks.
 *
 * The wrapper the Next export animates IS the page, so the percentages of
 * `pageTransitionVariants` measured the whole page: on a page eleven screens
 * tall the circle covered the screen for nearly all of its run and the new
 * page popped in within a frame or two, which reads as a flicker. The static
 * export's View Transition animates a picture of the screen, where the same
 * percentages mean the screen, and this puts the Next reveal in those terms: a
 * circle's radius in the screen's measure (CSS resolves a circle's percentage
 * against the diagonal over root two), its centre and the vertical edges on
 * the screen at the top of the new page, where a page opens. The sides already
 * match: the page is as wide as the screen.
 *
 * The leaving page has no exit of its own: it holds still under the arriving
 * page until the reveal has opened (the wrapper keeps it in the document that
 * long). Wiped away first, it left the site's bare background showing between
 * the two pages — a white sheet at every change.
 *
 * Without a measured screen (the first page, the server) only the settling
 * applies: a clip left on the whole page breaks the fixed header's blur and the
 * pinned scenes while scrolling, so the settled state drops it through framer's
 * own `transitionEnd` (framer applies it to the first page too, which appears
 * settled without animating).
 */
export function revealOnScreen(
  variants: PageTransitionVariants | null,
  screen?: PageTransitionScreen | null
): PageTransitionVariants | null {
  if (!variants || !variants.animate.clipPath) {
    return variants
  }
  const onScreen = (clip: unknown): unknown => {
    if (!screen || typeof clip !== 'string') {
      return clip
    }
    const circle = /^circle\(([\d.]+)% at ([\d.]+)px ([\d.]+)px\)$/.exec(clip)
    if (circle) {
      const measure = Math.sqrt((screen.width * screen.width + screen.height * screen.height) / 2)
      const radius = (parseFloat(circle[1]) / 100) * measure
      return 'circle(' + radius + 'px at ' + circle[2] + 'px ' + circle[3] + 'px)'
    }
    const inset = /^inset\((\S+) (\S+) (\S+) (\S+)\)$/.exec(clip)
    if (inset) {
      const share = (value: string) => (parseFloat(value) || 0) / 100
      const upper = share(inset[1]) * screen.height
      const lower = screen.height - share(inset[3]) * screen.height
      return (
        'inset(' +
        upper +
        'px ' +
        share(inset[2]) * 100 +
        '% calc(100% - ' +
        lower +
        'px) ' +
        share(inset[4]) * 100 +
        '%)'
      )
    }
    return clip
  }
  const arriving = (state: Record<string, unknown>) =>
    state.clipPath === undefined
      ? state
      : Object.assign({}, state, { clipPath: onScreen(state.clipPath) })
  return {
    initial: arriving(variants.initial),
    animate: Object.assign({}, arriving(variants.animate), {
      transitionEnd: { clipPath: 'none' },
    }),
    exit: {},
  }
}
