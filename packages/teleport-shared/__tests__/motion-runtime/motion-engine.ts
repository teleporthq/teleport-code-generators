import { motionEngineSource } from '../../src/motion-runtime/motion-engine-source'

type Style = Record<string, string>

interface FakeElement {
  style: Style
  attributes: Record<string, string>
  parentElement: FakeElement | null
  children: FakeElement[]
  hasAttribute: (name: string) => boolean
}

const fake = (
  attributes: Record<string, string> = {},
  children: FakeElement[] = []
): FakeElement => {
  const node: FakeElement = {
    style: {},
    attributes,
    parentElement: null,
    children,
    hasAttribute: (name) => name in attributes,
  }
  children.forEach((child) => {
    child.parentElement = node
  })
  return node
}

// The engine is shipped as text; these run that very text.
const engine = new Function(
  `${motionEngineSource()}
return { applyScrollState, letMarqueeSwipe }`
)() as {
  applyScrollState: (
    element: { style: Style },
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    progress: number
  ) => void
  letMarqueeSwipe: (track: FakeElement | null) => void
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

describe('a row that slides by itself, for a visitor who asks for less motion', () => {
  it('stands still and can be swiped: the frame scrolls sideways, the copy goes', () => {
    const row = fake()
    const copy = fake({ 'data-marquee-copy': 'true' })
    const track = fake({}, [row, copy])
    const frame = fake({ 'data-marquee': 'true' }, [track])

    engine.letMarqueeSwipe(track)

    expect(frame.style.overflowX).toBe('auto')
    expect(track.style.minWidth).toBe('100%')
    expect(copy.style.display).toBe('none')
    expect(row.style.display).toBeUndefined()
  })

  it('leaves a Motion element that is not the loop of a row alone', () => {
    const motion = fake({}, [fake({ 'data-marquee-copy': 'true' })])
    const parent = fake({}, [motion])

    engine.letMarqueeSwipe(motion)
    engine.letMarqueeSwipe(null)

    expect(parent.style.overflowX).toBeUndefined()
    expect(motion.style.minWidth).toBeUndefined()
  })
})
