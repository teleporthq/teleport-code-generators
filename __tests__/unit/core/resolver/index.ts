import { Resolver } from '../../../../src/core'
// @ts-ignore
import mappingJSON from '../../../fixtures/mapping.json'

const mapping = mappingJSON as Mapping

describe('resolveContentNode', () => {
  const element = {
    elementType: 'text',
    attrs: {
      dummy: { type: 'static', content: 'remains here' },
    },
  } as UIDLElement

  it('returns a mapped content node', () => {
    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolvedElement = resolver.resolveElement(element)
    expect(resolvedElement.elementType).toBe('span')
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })

  it('returns a mapped content node with a custom mapping', () => {
    const resolver = new Resolver()
    const resolvedElement = resolver.resolveElement(element, { mapping })
    expect(resolvedElement.elementType).toBe('span')
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })
})
