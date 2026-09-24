import { scrollVideoEngineSource } from '../../src/motion-runtime/scroll-video-engine-source'

// The engine is shipped as text; these run that very text.
const engine = new Function(
  `${scrollVideoEngineSource()}
return { clipPositionFor, normalizeWindow }`
)() as {
  clipPositionFor: (windowProgress: number, backToStart: boolean) => number
  normalizeWindow: (start: unknown, end: unknown) => { start: number; end: number }
}

describe('the scroll-video engine both exports run', () => {
  it('plays the clip once through the window by default', () => {
    expect([-0.2, 0, 0.25, 0.5, 1, 1.4].map((p) => engine.clipPositionFor(p, false))).toEqual([
      0, 0, 0.25, 0.5, 1, 1,
    ])
  })

  it('played back to the start: the last frame halfway, the first frame again at the end', () => {
    expect([0, 0.25, 0.5, 0.75, 1, 1.4].map((p) => engine.clipPositionFor(p, true))).toEqual([
      0, 0.5, 1, 0.5, 0, 0,
    ])
  })

  it('keeps a window playable', () => {
    expect(engine.normalizeWindow(40, 40)).toEqual({ start: 40, end: 41 })
  })
})
