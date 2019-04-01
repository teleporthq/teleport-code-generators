import { Resolver } from '../../../../src/core'
// @ts-ignore
import mappingJSON from '../../../fixtures/mapping.json'

const mapping = mappingJSON as Mapping

describe('resolveContentNode', () => {
  const contentNode = {
    type: 'text',
    attrs: {
      dummy: { type: 'static', content: 'remains here' },
    },
  } as ContentNode

  it('returns a mapped content node', () => {
    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolvedNode = resolver.resolveContentNode(contentNode)
    expect(resolvedNode.type).toBe('span')
    expect(resolvedNode.attrs.dummy.content).toBe('remains here')
  })

  it('returns a mapped content node with a custom mapping', () => {
    const resolver = new Resolver()
    const resolvedNode = resolver.resolveContentNode(contentNode, { customMapping: mapping })
    expect(resolvedNode.type).toBe('span')
    expect(resolvedNode.attrs.dummy.content).toBe('remains here')
  })
})
