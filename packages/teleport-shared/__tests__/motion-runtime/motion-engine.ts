import { motionEngineSource } from '../../src/motion-runtime/motion-engine-source'

type Style = Record<string, string>

// The engine is shipped as text; these run that very text.
const engine = new Function(
  `${motionEngineSource()}
return { applyScrollState }`
)() as {
  applyScrollState: (
    element: { style: Style },
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    progress: number
  ) => void
}

const styleAt = (from: Record<string, unknown>, to: Record<string, unknown>, progress: number) => {
  const element = { style: {} as Style }
  engine.applyScrollState(element, from, to, progress)
  return element.style
}

describe('the scroll-linked state both exports write', () => {
  it('glides a travel measured in the element’s own width, as the canvas does', () => {
    expect(styleAt({ x: '0%' }, { x: '-50%' }, 0.5).translate).toBe('-25% 0px')
    expect(styleAt({ x: '0%' }, { x: '-50%' }, 0).translate).toBe('0% 0px')
    expect(styleAt({ x: '0%' }, { x: '-50%' }, 1).translate).toBe('-50% 0px')
  })

  it('glides any unit both ends share', () => {
    expect(styleAt({ y: '40px' }, { y: '0px' }, 0.25).translate).toBe('0px 30px')
    expect(styleAt({ rotate: '-8deg' }, { rotate: '0deg' }, 0.25).rotate).toBe('-6deg')
    expect(styleAt({ x: '2rem' }, { x: '4rem' }, 0.25).translate).toBe('2.5rem 0px')
  })

  it('snaps when the two ends use different units, never mid-flight', () => {
    expect(styleAt({ x: '0%' }, { x: '-200px' }, 0.5).translate).toBe('0% 0px')
    expect(styleAt({ x: '0%' }, { x: '-200px' }, 1).translate).toBe('-200px 0px')
  })

  it('leaves numbers and filters as they were', () => {
    expect(styleAt({ opacity: 0, y: 40 }, { opacity: 1, y: 0 }, 0.5)).toEqual({
      opacity: '0.5',
      translate: '0px 20px',
    })
    expect(styleAt({ filter: 'blur(8px)' }, { filter: 'blur(0px)' }, 0.5).filter).toBe('blur(4px)')
  })
})
