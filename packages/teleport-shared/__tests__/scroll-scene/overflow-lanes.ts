import { scrollSceneEngineSource } from '../../src/scroll-scene/engine-source'
import { laneOverflowDistance } from '../../src/scroll-scene/overflow'

type Lane = { prop: string; at: number[]; values: number[]; unit?: string }

interface FakeBox {
  offsetLeft: number
  offsetTop: number
  offsetWidth: number
  offsetHeight: number
  clientLeft: number
  clientTop: number
  clientWidth: number
  clientHeight: number
  offsetParent: FakeBox | null
  parentElement: FakeBox | null
  isStage: boolean
  closest: (selector: string) => FakeBox | null
  style: Record<string, string>
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  hasAttribute: (name: string) => boolean
}

// Layout as the browser reports it: offsets relative to the offsetParent,
// sizes before any transform.
const box = (
  layout: Partial<FakeBox> & { parent?: FakeBox | null; positionedAncestor?: FakeBox | null }
): FakeBox => {
  const { parent = null, positionedAncestor, ...rest } = layout
  const node: FakeBox = {
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    clientLeft: 0,
    clientTop: 0,
    clientWidth: 0,
    clientHeight: 0,
    isStage: false,
    ...rest,
    offsetParent: positionedAncestor === undefined ? parent : positionedAncestor,
    parentElement: parent,
    closest: (selector) => {
      expect(selector).toBe('[data-scene-stage]')
      for (let current: FakeBox | null = node; current; current = current.parentElement) {
        if (current.isStage) {
          return current
        }
      }
      return null
    },
    style: {},
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    hasAttribute: () => false,
  }
  return node
}

const asElement = (node: FakeBox) => node as unknown as HTMLElement

const sceneStage = (width: number, height = 900) =>
  box({
    isStage: true,
    offsetWidth: width,
    offsetHeight: height,
    clientWidth: width,
    clientHeight: height,
  })

const engine = new Function(
  `${scrollSceneEngineSource()}
return { applyLanesAt, parseScrollBind, overflowSizeWatch }`
)() as {
  applyLanesAt: (element: FakeBox, lanes: Lane[], p: number) => void
  parseScrollBind: (value: string) => Lane[]
  overflowSizeWatch: (repaint: () => void) => {
    watch: (bound: Array<{ element: unknown; lanes: Lane[] }>, stage: unknown) => void
    stop: () => void
  }
}

const RIDE_TO_END = '[{"prop":"x","at":[0,1],"values":[0,-100],"unit":"overflow"}]'

describe('how far an element overflows its scene stage', () => {
  it('is the part of a full-width row past the stage edge', () => {
    const stage = sceneStage(1600)
    const chapter = box({ parent: stage, offsetWidth: 1600 })
    const track = box({ parent: chapter, offsetWidth: 2105 })

    expect(laneOverflowDistance(asElement(track), 'x')).toBe(505)
  })

  it('counts where the row starts inside the stage', () => {
    const stage = sceneStage(1440)
    const chapter = box({ parent: stage, offsetLeft: 120, offsetWidth: 1200 })
    const track = box({ parent: chapter, offsetWidth: 2000 })

    expect(laneOverflowDistance(asElement(track), 'x')).toBe(680)
  })

  it('climbs past ancestors that are not offset parents', () => {
    const stage = sceneStage(1440)
    const unpositioned = box({ parent: stage, positionedAncestor: stage })
    const track = box({
      parent: unpositioned,
      positionedAncestor: stage,
      offsetLeft: 60,
      offsetWidth: 1900,
    })

    expect(laneOverflowDistance(asElement(track), 'x')).toBe(520)
  })

  it('is nothing for a row that fits', () => {
    const stage = sceneStage(1440)
    const track = box({ parent: stage, offsetLeft: 48, offsetWidth: 900 })

    expect(laneOverflowDistance(asElement(track), 'x')).toBe(0)
  })

  it('measures a tall column against the stage bottom on y', () => {
    const stage = sceneStage(1440, 900)
    const column = box({ parent: stage, offsetTop: 100, offsetHeight: 1500 })

    expect(laneOverflowDistance(asElement(column), 'y')).toBe(700)
  })

  it('uses the parent as the box when there is no stage around it', () => {
    const parent = box({ clientWidth: 800, offsetWidth: 800 })
    const row = box({ parent, offsetWidth: 1000 })

    expect(laneOverflowDistance(asElement(row), 'x')).toBe(200)
  })
})

describe('an overflow lane in the exports', () => {
  it('is a lane the engine plays', () => {
    expect(engine.parseScrollBind(RIDE_TO_END)).toEqual([
      { prop: 'x', at: [0, 1], values: [0, -100], unit: 'overflow' },
    ])
    expect(
      engine.parseScrollBind('[{"prop":"x","at":[0,1],"values":[0,-100],"unit":"em"}]')
    ).toEqual([])
  })

  it('slides the row exactly to its last card at the end of the scene', () => {
    const stage = sceneStage(1600)
    const chapter = box({ parent: stage, offsetWidth: 1600 })
    const track = box({ parent: chapter, offsetWidth: 2105 })
    const lanes = engine.parseScrollBind(RIDE_TO_END)

    engine.applyLanesAt(track, lanes, 0)
    expect(track.style.translate).toBe('0px 0px')
    engine.applyLanesAt(track, lanes, 0.5)
    expect(track.style.translate).toBe('-252.5px 0px')
    engine.applyLanesAt(track, lanes, 1)
    expect(track.style.translate).toBe('-505px 0px')
  })

  it('follows the row when cards arrive or the screen narrows', () => {
    const stage = sceneStage(1600)
    const track = box({ parent: stage, offsetWidth: 2105 })
    const lanes = engine.parseScrollBind(RIDE_TO_END)

    track.offsetWidth = 3000
    engine.applyLanesAt(track, lanes, 1)
    expect(track.style.translate).toBe('-1400px 0px')

    stage.clientWidth = 390
    engine.applyLanesAt(track, lanes, 1)
    expect(track.style.translate).toBe('-2610px 0px')
  })

  it('leaves the other units as they were', () => {
    const track = box({ parent: sceneStage(1600), offsetWidth: 2105 })
    engine.applyLanesAt(track, [{ prop: 'x', at: [0, 1], values: [0, -70], unit: '%' }], 1)
    expect(track.style.translate).toBe('-70% 0px')
    engine.applyLanesAt(track, [{ prop: 'y', at: [0, 1], values: [40, -40] }], 1)
    expect(track.style.translate).toBe('0px -40px')
  })
})

// Luna, overflow-ride-01 run 1 (2026-10-28): a width change with no scroll
// left the row at the old distance, because nothing repainted the frame.
describe('a size change repaints an overflow lane', () => {
  const realResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  afterEach(() => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = realResizeObserver
  })

  it('watches only the stage and the rows with an overflow lane, and repaints on a resize', () => {
    const observed: unknown[] = []
    let notify: () => void = () => undefined
    let disconnects = 0
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) {
        notify = callback
      }
      observe(element: unknown) {
        observed.push(element)
      }
      disconnect() {
        disconnects++
        observed.length = 0
      }
    }
    let repaints = 0
    const sizeWatch = engine.overflowSizeWatch(() => repaints++)
    const stage = sceneStage(1600)
    const row = box({ parent: stage, offsetWidth: 2105 })
    const heading = box({ parent: stage, offsetWidth: 600 })

    sizeWatch.watch(
      [
        { element: row, lanes: engine.parseScrollBind(RIDE_TO_END) },
        { element: heading, lanes: engine.parseScrollBind('rise-in') },
      ],
      stage
    )
    expect(observed).toEqual([stage, row])
    notify()
    expect(repaints).toBe(1)

    sizeWatch.watch([{ element: heading, lanes: engine.parseScrollBind('rise-in') }], stage)
    expect(observed).toEqual([])

    sizeWatch.stop()
    expect(disconnects).toBe(3)
  })

  it('does nothing where the browser has no ResizeObserver', () => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined
    const sizeWatch = engine.overflowSizeWatch(() => undefined)
    expect(() => {
      sizeWatch.watch([], null)
      sizeWatch.stop()
    }).not.toThrow()
  })
})
