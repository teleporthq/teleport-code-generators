import { Resolver } from '../../../../src/core'
// @ts-ignore
import mappingJSON from '../../../fixtures/mapping.json'
import { element, staticNode } from '../../../../src/shared/builders/uidl-builders'
import { Mapping } from '../../../../src/typings/uidl-definitions'

const mapping = mappingJSON as Mapping

describe('resolveElement', () => {
  const uidlElement = element('text', {
    dummy: staticNode('remains here'),
  })

  it('returns a mapped content node', () => {
    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolvedElement = resolver.resolveElement(uidlElement)
    expect(resolvedElement.elementType).toBe('span')
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })

  it('returns a mapped content node with a custom mapping', () => {
    const resolver = new Resolver()
    const resolvedElement = resolver.resolveElement(uidlElement, { mapping })
    expect(resolvedElement.elementType).toBe('span')
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })
})
