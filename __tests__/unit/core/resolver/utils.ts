import {
  generateUniqueKeys,
  createNodesLookup,
  resolveChildren,
} from '../../../../src/core/resolver/utils'
import { elementNode, staticNode, dynamicNode } from '../../../../src/shared/builders/uidl-builders'

describe('generateUniqueKeys', () => {
  it('adds name and key to node', async () => {
    const simpleNode = elementNode('container')

    const lookup = {
      container: {
        count: 1,
        nextKey: '0',
      },
    }

    generateUniqueKeys(simpleNode, lookup)

    expect(simpleNode.content.name).toBe('container')
    expect(simpleNode.content.key).toBe('container')
  })

  it('adds name and generate unique key', async () => {
    const node = elementNode('container', {}, [elementNode('container')])

    const lookup = {
      container: {
        count: 2,
        nextKey: '0',
      },
    }

    generateUniqueKeys(node, lookup)

    expect(node.content.name).toBe('container')
    expect(node.content.key).toBe('container')

    const childNode = node.content.children[0].content as UIDLElement
    expect(childNode.name).toBe('container')
    expect(childNode.key).toBe('container1')
  })
})

describe('createNodesLookup', () => {
  it('counts duplicate nodes inside the UIDL', async () => {
    const node = elementNode('container', {}, [
      elementNode('container', {}, [elementNode('text'), elementNode('text'), elementNode('text')]),
    ])

    const lookup: Record<string, { count: number; nextKey: string }> = {}
    createNodesLookup(node, lookup)

    expect(lookup.container.count).toBe(2)
    expect(lookup.container.nextKey).toBe('0')
    expect(lookup.text.count).toBe(3)
    expect(lookup.container.nextKey).toBe('0')
  })

  it('adds zero padding when counting keys', async () => {
    const node = elementNode('container')

    const lookup: Record<string, { count: number; nextKey: string }> = {
      container: {
        count: 9,
        nextKey: '0',
      },
    }
    createNodesLookup(node, lookup)

    expect(lookup.container.count).toBe(10)
    expect(lookup.container.nextKey).toBe('00')
  })
})

describe('resolveChildren', () => {
  it('merges the children when no placeholder is found', () => {
    const mappedChildren = [staticNode('from-mapping')]
    const originalChildren = [staticNode('original-text')]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(2)
    expect(result[0].content).toBe('original-text')
    expect(result[1].content).toBe('from-mapping')
  })

  it('adds the mapped children if no original children are found', () => {
    const mappedChildren = [staticNode('from-mapping')]

    const result = resolveChildren(mappedChildren)
    expect(result.length).toBe(1)
    expect(result[0].content).toBe('from-mapping')
  })

  it('inserts the original children instead of the placeholder', () => {
    const mappedChildren = [dynamicNode('children', 'children')]
    const originalChildren = [staticNode('original-text')]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    expect(result[0].content).toBe('original-text')
  })

  it('inserts the original children in the nested structure, instead of the placeholder', () => {
    const mappedChildren = [elementNode('container', {}, [dynamicNode('children', 'children')])]
    const originalChildren = [staticNode('original-text')]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    const innerChildren = ((result[0].content as unknown) as UIDLElement).children
    expect(innerChildren.length).toBe(1)
    expect(innerChildren[0].content).toBe('original-text')
  })

  it('inserts multiple nodes instead of the placeholder', () => {
    const mappedChildren = [
      elementNode('container', {}, [
        dynamicNode('children', 'children'),
        staticNode('remains here'),
      ]),
    ]

    const originalChildren: UIDLNode[] = [
      staticNode('original-text'),
      staticNode('other-original-text'),
    ]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    const innerChildren = ((result[0].content as unknown) as UIDLElement).children
    expect(innerChildren.length).toBe(3)
    expect(innerChildren[0].content).toBe('original-text')
    expect(innerChildren[1].content).toBe('other-original-text')
    expect(innerChildren[2].content).toBe('remains here')
  })

  it('inserts multiple nodes instead of multiple placeholders', () => {
    const mappedChildren = [
      elementNode('container', {}, [
        dynamicNode('children', 'children'),
        staticNode('remains here'),
        dynamicNode('children', 'children'),
      ]),
    ]

    const originalChildren: UIDLNode[] = [
      staticNode('original-text'),
      staticNode('other-original-text'),
    ]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    const innerChildren = ((result[0].content as unknown) as UIDLElement).children
    expect(innerChildren.length).toBe(5)
    expect(innerChildren[0].content).toBe('original-text')
    expect(innerChildren[1].content).toBe('other-original-text')
    expect(innerChildren[2].content).toBe('remains here')
    expect(innerChildren[3].content).toBe('original-text')
    expect(innerChildren[4].content).toBe('other-original-text')
  })
})
