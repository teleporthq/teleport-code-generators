import type { PageTransitionVariants } from './page-transition-variants'

// Object.assign, not a spread: this package compiles to ES5, where a spread
// becomes a call to tsc's `__assign` helper — outside the function, so missing
// from the source injected into the generated component.
/* tslint:disable:prefer-object-spread */

/** The screen a page change starts on, measured at `routeChangeStart`. */
export interface PageTransitionScreen {
  width: number
  height: number
  /** The leaving page's scroll offset: where on that page the screen sits. */
  top: number
}

/**
 * A reveal's clip (Circle, the Wipes) measured on the SCREEN, and dropped once
 * the page has settled. Injected into `components/tq-page-transition.js` with
 * `toString()`: plain JS in the body, nothing from outside it, no backticks.
 *
 * The wrapper the Next export animates IS the page, so the percentages of
 * `pageTransitionVariants` measured the whole page: on a page eleven screens
 * tall the circle covered the screen for nearly all of its run — the leaving
 * page stood still, then vanished, and the new one popped in within a frame or
 * two, which reads as a flicker. Leaving a scrolled page, the circle also
 * closed on a point above the screen. The static export's View Transition
 * animates a picture of the screen, where the same percentages mean the
 * screen, and this puts the Next reveal in those terms: a circle's radius in
 * the screen's measure (CSS resolves a circle's percentage against the
 * diagonal over root two), its centre and the vertical edges on the part of the
 * page the screen shows — at the leaving page's scroll offset for the exit (it
 * is frozen where it stood), at the top for the arrival (a new page opens at
 * its top). The sides already match: the page is as wide as the screen.
 *
 * Without a measured screen (the first page, the server) only the settling
 * applies: a clip left on the whole page breaks the fixed header's blur and the
 * pinned scenes while scrolling, so the settled state drops it through framer's
 * own `transitionEnd` (framer applies it to the first page too, which appears
 * settled without animating), and the exit starts from the full reveal as its
 * first keyframe instead of from whatever the page holds.
 */
export function revealOnScreen(
  variants: PageTransitionVariants | null,
  screen?: PageTransitionScreen | null
): PageTransitionVariants | null {
  if (!variants || !variants.animate.clipPath) {
    return variants
  }
  const onScreen = (clip: unknown, top: number): unknown => {
    if (!screen || typeof clip !== 'string') {
      return clip
    }
    const circle = /^circle\(([\d.]+)% at ([\d.]+)px ([\d.]+)px\)$/.exec(clip)
    if (circle) {
      const measure = Math.sqrt((screen.width * screen.width + screen.height * screen.height) / 2)
      const radius = (parseFloat(circle[1]) / 100) * measure
      return (
        'circle(' + radius + 'px at ' + circle[2] + 'px ' + (parseFloat(circle[3]) + top) + 'px)'
      )
    }
    const inset = /^inset\((\S+) (\S+) (\S+) (\S+)\)$/.exec(clip)
    if (inset) {
      const share = (value: string) => (parseFloat(value) || 0) / 100
      const upper = top + share(inset[1]) * screen.height
      const lower = top + screen.height - share(inset[3]) * screen.height
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
      : Object.assign({}, state, { clipPath: onScreen(state.clipPath, 0) })
  const leavingTop = screen ? screen.top : 0
  return {
    initial: arriving(variants.initial),
    animate: Object.assign({}, arriving(variants.animate), {
      transitionEnd: { clipPath: 'none' },
    }),
    exit:
      variants.exit.clipPath === undefined
        ? variants.exit
        : Object.assign({}, variants.exit, {
            clipPath: [
              onScreen(variants.animate.clipPath, leavingTop),
              onScreen(variants.exit.clipPath, leavingTop),
            ],
          }),
  }
}
