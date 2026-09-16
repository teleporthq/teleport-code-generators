import { SCROLL_POINT_PROGRESS } from '@teleporthq/teleport-plugin-next-workflows'
import {
  passedScenePoints,
  scenePointList,
  scenePointRank,
} from '../src/widgets/scroll-scene-points'

describe('scene points (generated runtime)', () => {
  it('lists the four plain points in scroll order, the same the workflow plugin binds to', () => {
    expect(scenePointList().map((point) => point.key)).toEqual([
      'quarter',
      'half',
      'three-quarters',
      'end',
    ])
    const fromRuntime = Object.fromEntries(scenePointList().map((p) => [p.key, p.at]))
    expect(fromRuntime).toEqual(SCROLL_POINT_PROGRESS)
  })

  it('announces every point a downward move passes, in order', () => {
    expect(passedScenePoints(0, 0.1)).toEqual([])
    expect(passedScenePoints(0.1, 0.25)).toEqual(['quarter'])
    expect(passedScenePoints(0.3, 0.8)).toEqual(['half', 'three-quarters'])
    expect(passedScenePoints(-1, 1)).toEqual(['quarter', 'half', 'three-quarters', 'end'])
  })

  it('announces nothing on the way up, so a point fires again on the next way down', () => {
    expect(passedScenePoints(0.8, 0.3)).toEqual([])
    expect(passedScenePoints(0.3, 0.6)).toEqual(['half'])
  })

  it('tolerates float noise right at a point', () => {
    expect(passedScenePoints(0.2, 0.5 - 1e-9)).toEqual(['quarter', 'half'])
    expect(passedScenePoints(0.25 + 1e-9, 0.4)).toEqual([])
  })

  it('ranks points for listeners that attach after the announcement', () => {
    expect(scenePointRank('quarter')).toBe(1)
    expect(scenePointRank('end')).toBe(4)
    expect(scenePointRank('nowhere')).toBe(0)
  })

  it('its source survives injection into the runtime as plain JS', () => {
    for (const fn of [scenePointList, passedScenePoints, scenePointRank]) {
      expect(fn.toString()).toContain('function ' + fn.name)
      expect(fn.toString()).not.toContain('`')
    }
  })
})
