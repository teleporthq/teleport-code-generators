import { settledMomentForLanes } from '../src/widgets/scroll-scene-moment'

/**
 * Mirrored verbatim from teleport-gui's chapter-moment.test.ts — the editor
 * draws the same moment the published site settles on.
 */
const lane = (at: number[], values: number[]) => ({ at, values })

describe('settledMomentForLanes (generated runtime)', () => {
  it('a Cascade-like chapter settles after its LAST beat, not at the window midpoint', () => {
    const lanes = [
      lane([0.25, 0.2875, 0.4625, 0.5], [0, 1, 1, 0]),
      lane([0.25, 0.2875, 0.3175, 0.4625, 0.5], [0, 0, 1, 1, 0]),
      lane([0.25, 0.33, 0.36, 0.4625, 0.5], [0, 0, 1, 1, 0]),
      lane([0.25, 0.3725, 0.4025, 0.4625, 0.5], [0, 0, 1, 1, 0]),
    ]
    expect(settledMomentForLanes(lanes)).toBe(0.4325)
  })

  it('a first chapter whose root starts settled counts from the scene start', () => {
    expect(settledMomentForLanes([lane([0, 0.15, 0.85, 1], [1, 1, 1, 0])])).toBe(0.425)
  })

  it('a last chapter never leaves — the span runs to its final stop', () => {
    expect(settledMomentForLanes([lane([0.5, 0.575, 0.925, 1], [0, 1, 1, 1])])).toBe(0.7875)
  })

  it('a read-along settles once the last word is lit, before the root fades', () => {
    const lanes = [
      lane([0.5, 0.575, 0.925, 1], [0, 1, 1, 0]),
      lane([0.5, 0.55, 0.6, 1], [0.22, 0.22, 1, 1]),
      lane([0.5, 0.85, 0.9, 1], [0.22, 0.22, 1, 1]),
    ]
    expect(settledMomentForLanes(lanes)).toBe(0.9125)
  })

  it('through-motion only has no settled moment', () => {
    expect(settledMomentForLanes([lane([0.75, 1], [100, -100])])).toBeNull()
  })

  it('its source survives injection into the runtime as plain JS', () => {
    const source = settledMomentForLanes.toString()
    expect(source).toContain('function settledMomentForLanes')
    expect(source).not.toContain('`')
  })
})
