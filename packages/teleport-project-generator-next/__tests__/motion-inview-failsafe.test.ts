/* tslint:disable:no-eval */
import { generateMotionComponentCode } from '../src/widgets/motion-component'

/**
 * The in-view failsafe exists so a reveal animation can never leave content at
 * opacity 0. It used to be a single `setTimeout` that checked once, about a
 * second after mount — which only rescued content already on screen at that
 * instant. Everything below the fold was checked once while off-screen, found
 * invisible, and never checked again, leaving the IntersectionObserver as the
 * only thing that could ever reveal it. One missed callback meant a section
 * stayed invisible permanently; a 2162px product grid sat at opacity 0 while
 * dead-centre in the viewport and 41% on screen.
 *
 * The emitted component is a source STRING, so nothing else in the toolchain
 * can check any of this.
 */
describe('TqMotion in-view failsafe', () => {
  const code = generateMotionComponentCode()

  it('keeps watching for the element lifetime, not once after mount', () => {
    expect(code).toContain("window.addEventListener('scroll', schedule, { passive: true })")
    expect(code).toContain("window.addEventListener('resize', schedule, { passive: true })")
    expect(code).toContain("window.removeEventListener('scroll', schedule)")
    expect(code).toContain("window.removeEventListener('resize', schedule)")
  })

  it('coalesces scroll work into a frame so a page of motion nodes stays cheap', () => {
    expect(code).toContain('requestAnimationFrame')
    expect(code).toContain('cancelAnimationFrame')
  })

  it('reveals on the same threshold useInView was given, so timing is unchanged', () => {
    // Not "any pixel visible": the failsafe must fire when the observer should
    // have, never earlier, or every animation on the page starts too soon.
    expect(code).toContain(
      'const threshold = Math.min(amount, reachableFraction(rect, vh, vw) * 0.9)'
    )
    expect(code).toContain('const visible = fraction > 0 && fraction >= threshold')
  })

  it('still honours inViewOnce in both directions', () => {
    // Latching a repeat-on-re-entry animation would silently disable it.
    expect(code).toContain('return once ? previous || visible : visible')
  })

  it('does nothing for triggers that are not in-view', () => {
    expect(code).toContain("if (trigger !== 'in-view') {")
  })

  describe('the visibility maths', () => {
    // Extracted and evaluated directly — these two functions decide whether a
    // section is ever seen, and they are the part a string assertion cannot
    // meaningfully cover.
    const extract = (name: string): ((...args: unknown[]) => number) => {
      const start = code.indexOf(`const ${name} = (rect, vh, vw) => {`)
      expect(start).toBeGreaterThan(-1)
      const end = code.indexOf('\n}', start)
      const source = code.slice(start, end + 2).replace(`const ${name} =`, 'return')
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function(source)() as (...args: unknown[]) => number
    }

    const visibleFraction = extract('visibleFraction')
    const reachableFraction = extract('reachableFraction')
    const rect = (top: number, height: number) => ({
      top,
      bottom: top + height,
      left: 0,
      right: 1440,
    })

    it('measures how much of the element is on screen', () => {
      // Fully inside the viewport.
      expect(visibleFraction(rect(100, 400), 900, 1440)).toBeCloseTo(1)
      // Entirely below the fold.
      expect(visibleFraction(rect(1000, 400), 900, 1440)).toBe(0)
      // Half of it scrolled past the top.
      expect(visibleFraction(rect(-200, 400), 900, 1440)).toBeCloseTo(0.5)
    })

    it('reports what a too-tall element can physically reach', () => {
      // The real regression: 2162px tall in a 900px viewport can never exceed
      // 41.6% on screen, so any inViewAmount above that is unsatisfiable.
      expect(reachableFraction(rect(-631, 2162), 900, 1440)).toBeCloseTo(900 / 2162, 3)
      // Something that fits can reach all of itself.
      expect(reachableFraction(rect(0, 400), 900, 1440)).toBe(1)
    })

    it('never demands more visibility than the element can achieve', () => {
      // A 3000px section asked for amount 0.6 — impossible (max 0.3). Without
      // the clamp this content stays hidden forever.
      const tall = rect(0, 3000)
      const reachable = reachableFraction(tall, 900, 1440)
      const threshold = Math.min(0.6, reachable * 0.9)
      expect(threshold).toBeLessThan(reachable)
      expect(visibleFraction(tall, 900, 1440)).toBeGreaterThanOrEqual(threshold)
    })

    it('degrades to zero rather than NaN on a collapsed element', () => {
      expect(visibleFraction(rect(0, 0), 900, 1440)).toBe(0)
      expect(reachableFraction(rect(0, 0), 900, 1440)).toBe(0)
    })
  })
})
