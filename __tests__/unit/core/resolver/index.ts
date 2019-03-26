import { Resolver } from '../../../../src/core'
// @ts-ignore
import mapping from '../../../fixtures/mapping.json'

describe('resolveContentNode', () => {
  const contentNode = {
    type: 'text',
    attrs: {
      dummy: 'remains here',
    },
  }

  it('returns a mapped content node', () => {
    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolvedNode = resolver.resolveContentNode(contentNode)
    expect(resolvedNode.type).toBe('span')
    expect(resolvedNode.attrs.dummy).toBe('remains here')
  })

  it('returns a mapped content node with a custom mapping', () => {
    const resolver = new Resolver()
    const resolvedNode = resolver.resolveContentNode(contentNode, { customMapping: mapping })
    expect(resolvedNode.type).toBe('span')
    expect(resolvedNode.attrs.dummy).toBe('remains here')
  })
})
