import Resolver from '../../src/resolver'
import { HTMLMapping } from '../../src/html-mapping'
import { element, staticNode, dynamicNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLElement } from '@teleporthq/teleport-types'

describe('Image width and height attributes', () => {
  const resolveImage = (
    style: UIDLElement['style'],
    attrs: UIDLElement['attrs'] = {},
    elementType = 'image'
  ) => {
    const resolver = new Resolver()
    resolver.addMapping(HTMLMapping)
    const image = element(
      elementType,
      { url: staticNode('/a.png'), ...attrs },
      [],
      undefined,
      undefined,
      style
    )
    return resolver.resolveElement(image)
  }

  it('copies pixel dimensions from the style onto the attributes without the unit', () => {
    const resolved = resolveImage({ width: staticNode('200px'), height: staticNode('120px') })

    expect(resolved.elementType).toBe('img')
    expect(resolved.attrs.width).toEqual({ type: 'static', content: '200' })
    expect(resolved.attrs.height).toEqual({ type: 'static', content: '120' })
  })

  it('treats unitless numbers as pixels', () => {
    const resolved = resolveImage({ width: staticNode(64), height: staticNode('48') })

    expect(resolved.attrs.width.content).toBe('64')
    expect(resolved.attrs.height.content).toBe('48')
  })

  it('keeps the style untouched', () => {
    const resolved = resolveImage({ width: staticNode('200px') })
    expect(resolved.style.width.content).toBe('200px')
  })

  it('only sets the dimension that is a fixed pixel value', () => {
    const resolved = resolveImage({ width: staticNode('200px'), height: staticNode('auto') })

    expect(resolved.attrs.width.content).toBe('200')
    expect(resolved.attrs.height).toBeUndefined()
  })

  it('ignores relative units, keywords, calc and dynamic values', () => {
    const resolved = resolveImage({
      width: staticNode('50%'),
      height: dynamicNode('prop', 'height'),
    })
    expect(resolved.attrs.width).toBeUndefined()
    expect(resolved.attrs.height).toBeUndefined()

    const other = resolveImage({
      width: staticNode('calc(100% - 20px)'),
      height: staticNode('10rem'),
    })
    expect(other.attrs.width).toBeUndefined()
    expect(other.attrs.height).toBeUndefined()
  })

  it('does not override attributes set on the element', () => {
    const resolved = resolveImage(
      { width: staticNode('200px'), height: staticNode('120px') },
      { width: staticNode('300') }
    )

    expect(resolved.attrs.width.content).toBe('300')
    expect(resolved.attrs.height.content).toBe('120')
  })

  it('does not touch elements that are not images', () => {
    const resolved = resolveImage({ width: staticNode('200px') }, {}, 'container')

    expect(resolved.elementType).toBe('div')
    expect(resolved.attrs.width).toBeUndefined()
  })
})
