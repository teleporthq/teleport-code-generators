import { scrollSceneEngineSource } from '../../src/scroll-scene/engine-source'

type Lane = { prop: string; at: number[]; values: number[]; unit?: string }
type FakeElement = {
  style: Record<string, string> & { setProperty: (name: string, value: string) => void }
  attributes: Record<string, string>
  width: number
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  hasAttribute: (name: string) => boolean
  getBoundingClientRect: () => { width: number }
}

// The engine is shipped as text; these run that very text.
const engine = new Function(
  `${scrollSceneEngineSource()}
return { storyLanes, applyLanesAt, clearMovement, letRowsSwipe, parseScrollBind }`
)() as {
  storyLanes: (lanes: Lane[]) => Lane[]
  applyLanesAt: (element: FakeElement, lanes: Lane[], p: number) => void
  clearMovement: (element: FakeElement, lanes: Lane[]) => void
  letRowsSwipe: (bound: Array<{ element: FakeElement; lanes: Lane[] }>, stage: unknown) => void
  parseScrollBind: (value: string) => Lane[]
}

const element = (width = 400): FakeElement => {
  const style = {} as FakeElement['style']
  style.setProperty = (name: string, value: string) => {
    style[name] = value
  }
  const attributes: Record<string, string> = {}
  return {
    style,
    attributes,
    width,
    setAttribute: (name, value) => {
      attributes[name] = value
    },
    removeAttribute: (name) => {
      delete attributes[name]
    },
    hasAttribute: (name) => name in attributes,
    getBoundingClientRect: () => ({ width }),
  }
}

const RISE_IN = engine.parseScrollBind('rise-in')

describe('a story scene for visitors who ask for less motion', () => {
  it('keeps the fades and filters and drops every movement', () => {
    const lanes: Lane[] = [
      { prop: 'y', at: [0, 0.35], values: [70, 0] },
      { prop: 'x', at: [0, 1], values: [0, -100], unit: '%' },
      { prop: 'scale', at: [0, 1], values: [0.85, 1.1] },
      { prop: 'rotate', at: [0, 0.35], values: [-90, 0] },
      { prop: 'rotate-x', at: [0, 0.4], values: [35, 0] },
      { prop: 'clip', at: [0, 0.4], values: [0, 100] },
      { prop: 'clip-y', at: [0, 0.4], values: [0, 100] },
      { prop: 'opacity', at: [0, 0.3], values: [0, 1] },
      { prop: 'blur', at: [0, 0.3], values: [10, 0] },
      { prop: 'grayscale', at: [0, 0.45], values: [1, 0] },
    ]
    expect(engine.storyLanes(lanes).map((lane) => lane.prop)).toEqual([
      'opacity',
      'blur',
      'grayscale',
    ])
  })

  it('shows a counting number at the figure it counts to', () => {
    expect(engine.storyLanes([{ prop: 'count', at: [0.1, 0.4], values: [0, 48] }])).toEqual([
      { prop: 'count', at: [0, 1], values: [48, 48] },
    ])
  })

  it('fades an entrance in where the layout puts it, without the rise', () => {
    const heading = element()
    engine.applyLanesAt(heading, engine.storyLanes(RISE_IN), 0.15)

    expect(heading.style.opacity).toBe('0.5')
    expect(heading.style.translate).toBeUndefined()
    engine.applyLanesAt(heading, engine.storyLanes(RISE_IN), 0.6)
    expect(heading.style.opacity).toBe('1')
    expect(heading.style.translate).toBeUndefined()
  })

  it('takes off the movement a scene painted before it switched to the story', () => {
    const card = element()
    const lanes: Lane[] = [
      { prop: 'y', at: [0, 1], values: [40, -40] },
      { prop: 'scale', at: [0, 1], values: [0.85, 1.1] },
      { prop: 'rotate', at: [0, 1], values: [-5, 5] },
      { prop: 'clip', at: [0, 1], values: [0, 100] },
    ]
    engine.applyLanesAt(card, lanes, 0.5)
    expect(card.style.translate).toBe('0px 0px')

    engine.clearMovement(card, lanes)

    expect(card.style.translate).toBe('')
    expect(card.style.scale).toBe('')
    expect(card.style.rotate).toBe('')
    expect(card.style.clipPath).toBe('')
  })

  it('lets a row wider than the stage that travelled sideways be swiped, and nothing else', () => {
    const stage = { getBoundingClientRect: () => ({ width: 1440 }) }
    const rail = element(2400)
    const slideIn = element(600)
    const wideStill = element(2400)
    engine.letRowsSwipe(
      [
        { element: rail, lanes: engine.parseScrollBind('rail-x') },
        { element: slideIn, lanes: [{ prop: 'x', at: [0, 0.3], values: [-60, 0] }] },
        { element: wideStill, lanes: RISE_IN },
      ],
      stage
    )

    expect(rail.style.overflowX).toBe('auto')
    expect(rail.style.maxWidth).toBe('100%')
    expect(rail.attributes['data-scene-swipe']).toBe('')
    expect(slideIn.style.overflowX).toBeUndefined()
    expect(wideStill.style.overflowX).toBeUndefined()
  })
})
