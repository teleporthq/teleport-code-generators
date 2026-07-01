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

type StubElement = { $$typeof: 'react.element'; type: string; props: Record<string, unknown> }

const element = (type: string, props: Record<string, unknown> = {}): StubElement => ({
  $$typeof: 'react.element',
  type,
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
})

describe('generated TqMotion source', () => {
  it('falls through to a group animation when there are no per-item stagger targets', () => {
    const code = generateMotionComponentCode()
    // The stagger branch must guard the wrapper render on a non-null result and let
    // the trailing <motion.div ... {...animProps}> group render handle the null case.
    expect(code).toContain('const staggerTargets = mapStaggerTargets(children, wrapChild, 0)')
    expect(code).toContain('if (staggerTargets != null) {')
  })
})
