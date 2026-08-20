import { generateMotionComponentCode } from '../src/widgets/motion-component'

/**
 * The TqMotion `stagger` resolver (`mapStaggerTargets`) descends through single-child
 * wrappers (e.g. a grid) to the real repeated items so it can cascade THOSE. The
 * regression guarded here: when the repeated items render from a runtime <Repeater>
 * (array-mapper) the descent bottoms out at a self-closing element whose
 * `props.children` is undefined. Wrapping that lone block in a motion.div used to
 * drop a single <div> BETWEEN the grid/flex container and its repeated items,
 * collapsing every card into one grid cell on the deployed site. The resolver must
 * now return null so the caller falls back to a single group animation (wrapper
 * stays OUTSIDE the container) instead.
 *
 * The emitted component is a JSX source string, but `mapStaggerTargets` itself is
 * pure JS (only React.Children/isValidElement/cloneElement), so we extract and eval
 * it against a minimal React stub — the same "eval the emitted runtime source"
 * approach used for workflow node handlers.
 */

type StubElement = {
  $$typeof: 'react.element'
  type: string | (() => null)
  props: Record<string, unknown>
}

const element = (type: string, props: Record<string, unknown> = {}): StubElement => ({
  $$typeof: 'react.element',
  type,
  props,
})

/** An element whose type is a COMPONENT (function), like `next/link`'s <Link>. */
const componentElement = (props: Record<string, unknown> = {}): StubElement => ({
  $$typeof: 'react.element',
  type: () => null,
  props,
})

const ReactStub = {
  Children: {
    toArray: (nodes: unknown): unknown[] =>
      (Array.isArray(nodes) ? nodes : nodes == null ? [] : [nodes]).filter((n) => n != null),
  },
  isValidElement: (el: unknown): boolean =>
    !!el && typeof el === 'object' && (el as StubElement).$$typeof === 'react.element',
  cloneElement: (el: StubElement, _props: unknown, children: unknown): StubElement => ({
    ...el,
    props: { ...el.props, children },
  }),
}

const extractMapStaggerTargets = () => {
  const code = generateMotionComponentCode()
  const start = code.indexOf('const mapStaggerTargets')
  const end = code.indexOf('\n\nconst TqMotion', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const source = code.slice(start, end)
  // eslint-disable-next-line no-new-func
  const factory = new Function('React', `${source}\nreturn mapStaggerTargets`)
  return factory(ReactStub) as (nodes: unknown, wrap: unknown, depth: number) => unknown
}

/**
 * `cssFromState` is the bridge between the motion contract and the inline style the
 * in-place cascade writes. It has to compose transforms in the SAME order as the
 * canvas (`cssFromState` in packages/renderer motion-keyframes) or a staggered card
 * and its canvas twin would resolve the same values to different matrices.
 */
const extractCssFromState = () => {
  const code = generateMotionComponentCode()
  const start = code.indexOf('const TRANSFORM_KEYS')
  const end = code.indexOf('\n\n// How much of the element is inside the viewport', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const source = code.slice(start, end)
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${source}\nreturn cssFromState`)
  return factory() as (state: Record<string, number | string>) => Record<string, unknown>
}

describe('TqMotion stagger resolution (mapStaggerTargets)', () => {
  const mapStaggerTargets = extractMapStaggerTargets()
  // Marks each per-item wrapper the stagger path would emit.
  const wrap = (child: unknown, index: number) => element('motion.div', { child, index })

  it('returns null for a grid whose only child is a runtime <Repeater> (group fallback)', () => {
    // <div class="grid"><Repeater items renderItem /></div> — Repeater is self-closing,
    // so its props.children is undefined and the descent cannot reach the cards.
    const repeater = element('Repeater', { items: [], renderItem: () => null })
    const grid = element('div', { className: 'operations-kpis-grid', children: repeater })

    const result = mapStaggerTargets(grid, wrap, 0)

    // null => the caller plays one group animation with the wrapper OUTSIDE the grid,
    // so the Repeater's cards stay direct grid children (layout preserved).
    expect(result).toBeNull()
  })

  it('still cascades real, statically-present repeated items as per-item wrappers', () => {
    const grid = element('div', {
      className: 'cards',
      children: [
        element('div', { className: 'card', children: 'a' }),
        element('div', { className: 'card', children: 'b' }),
        element('div', { className: 'card', children: 'c' }),
      ],
    })

    const result = mapStaggerTargets(grid, wrap, 0) as StubElement
    // The grid is preserved (cloned), and each card becomes its own motion.div grid item.
    expect(result.type).toBe('div')
    const wrapped = result.props.children as StubElement[]
    expect(wrapped).toHaveLength(3)
    expect(wrapped.every((w) => w.type === 'motion.div')).toBe(true)
  })

  it('returns null for a single non-cascadable leaf (no spurious wrapper)', () => {
    const lone = element('img', { src: 'x' })
    expect(mapStaggerTargets(lone, wrap, 0)).toBeNull()
  })

  // ⛔ THE REPORTED DEFECT (run 75860d32, "Start by Concern" on Routine Guide).
  // The lone-child guard above only fires for a container whose ONLY child is the
  // repeater. That grid held the mapper AND one static "text pivot" card, so the
  // array was length 2, both branches were wrapped, and the mapper's four cards
  // shipped stacked inside ONE cell of a repeat(3, 1fr) grid — one column of tall
  // cards, the pivot beside it, and the third column empty down the whole band.
  it('returns null when a <Repeater> sits BESIDE a static sibling in the same container', () => {
    const grid = element('div', {
      className: 'collage-grid',
      children: [
        element('Repeater', { items: [], renderItem: (): null => null }),
        element('div', { className: 'collage-item text-pivot', children: 'Your Glow Pathway' }),
      ],
    })

    expect(mapStaggerTargets(grid, wrap, 0)).toBeNull()
  })

  it('returns null for a table-backed <DataProvider> beside a static sibling', () => {
    // A table-backed array-mapper compiles to <DataProvider renderSuccess={…}> —
    // opaque at build time for the same reason, so it collapses the same way.
    const grid = element('div', {
      className: 'people-grid',
      children: [
        element('DataProvider', { name: 'team_members', renderSuccess: (): null => null }),
        element('div', { className: 'people-cta', children: 'Join us' }),
      ],
    })

    expect(mapStaggerTargets(grid, wrap, 0)).toBeNull()
  })

  it('still cascades when the repeater sits inside its own wrapper beside a sibling', () => {
    // The wrapper is ALREADY the box between the grid and the items, so a
    // motion.div around it changes no layout — only the repeater as a DIRECT
    // child of the laying-out container is the collapse case.
    const grid = element('div', {
      className: 'cards',
      children: [
        element('div', {
          className: 'card-rail',
          children: element('Repeater', { items: [], renderItem: (): null => null }),
        }),
        element('div', { className: 'card', children: 'static' }),
      ],
    })

    const result = mapStaggerTargets(grid, wrap, 0) as StubElement
    const wrapped = result.props.children as StubElement[]
    expect(wrapped).toHaveLength(2)
    expect(wrapped.every((w) => w.type === 'motion.div')).toBe(true)
  })

  // ⛔ THE REPORTED DEFECT (run c133d485, "How the Appointment Works"). Wrapping each
  // target in a motion.div put an anonymous box between `.process-rail` (flex,
  // width: max-content) and its `.process-step-card` items, so `flex: 0 0 380px`
  // reached nothing, every wrapper shrink-wrapped to 1500px of max-content copy and
  // the rail measured 6096px against a 1056px viewport. The canvas writes the tween
  // straight onto the targets, so its tree stayed correct — the divergence WAS the
  // wrapper. A component target can silently drop an injected style (next/link
  // does), so it disqualifies the cascade instead of resurrecting the wrapper.
  it('returns null when a stagger target is a component rather than a DOM element', () => {
    const grid = element('div', {
      className: 'cards',
      children: [
        element('div', { className: 'card', children: 'a' }),
        componentElement({ href: '/x', children: 'b' }),
      ],
    })

    expect(mapStaggerTargets(grid, wrap, 0)).toBeNull()
  })

  it('cascades a row of plain DOM elements (all styleable in place)', () => {
    const rail = element('div', {
      className: 'process-rail',
      children: [
        element('div', { className: 'process-step-card', children: '1' }),
        element('div', { className: 'process-step-card', children: '2' }),
      ],
    })

    const result = mapStaggerTargets(rail, wrap, 0) as StubElement
    expect(result.props.children as StubElement[]).toHaveLength(2)
  })
})

describe('generated TqMotion source', () => {
  it('falls through to a group animation when there are no per-item stagger targets', () => {
    const code = generateMotionComponentCode()
    // The stagger branch must guard the render on a non-null result and let the
    // trailing <motion.div ... {...animProps}> group render handle the null case.
    expect(code).toContain('const staggerTargets = mapStaggerTargets(children, styleChild, 0)')
    expect(code).toContain('if (staggerTargets != null) {')
  })

  it('cascades IN PLACE — the per-item wrapper element is gone', () => {
    const code = generateMotionComponentCode()
    // Clone-with-style, never a per-item box.
    expect(code).toContain('return React.cloneElement(child, {')
    expect(code).not.toContain('<motion.div key={index}')
    // The outer wrapper stays a motion.div so the stagger and group branches render
    // the same element type (framer's useInView must not lose its node on a flip).
    expect(code).toContain('<motion.div ref={ref} style={style} {...rest}>')
  })

  it('keeps the framer path for a REPEATING stagger (a CSS transition plays once)', () => {
    const code = generateMotionComponentCode()
    expect(code).toContain(
      "if (Number(stagger) > 0 && repeatCount === 0 && (trigger === 'load' || trigger === 'in-view'))"
    )
  })
})

describe('generated cssFromState (canvas parity)', () => {
  const cssFromState = extractCssFromState()

  it('collapses the transform family into one string, in the canvas order', () => {
    expect(cssFromState({ opacity: 0, y: 30, scale: 0.8 })).toEqual({
      opacity: 0,
      transform: 'translateY(30px) scale(0.8)',
    })
    expect(cssFromState({ x: -10, y: 4, scale: 2, rotate: -8 })).toEqual({
      transform: 'translateX(-10px) translateY(4px) scale(2) rotate(-8deg)',
    })
  })

  it('passes non-transform properties through untouched', () => {
    expect(cssFromState({ opacity: 0, filter: 'blur(12px)' })).toEqual({
      opacity: 0,
      filter: 'blur(12px)',
    })
  })

  it('emits no transform when the state has no transform keys', () => {
    expect(cssFromState({ opacity: 1 })).toEqual({ opacity: 1 })
  })
})
