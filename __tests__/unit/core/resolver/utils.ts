import { generateUniqueKeys, createNodesLookup } from '../../../../src/core/resolver/utils'

describe('generateUniqueKeys', () => {
  it('adds name and key to node', async () => {
    const simpleNode: UIDLNode = {
      type: 'element',
      content: {
        elementType: 'container',
        name: 'container',
      },
    }

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
    const node: UIDLNode = {
      type: 'element',
      content: {
        elementType: 'container',
        name: 'container',
        children: [
          {
            type: 'element',
            content: {
              elementType: 'container',
              name: 'container',
            },
          },
        ],
      },
    }

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
    const node: UIDLNode = {
      type: 'element',
      content: {
        elementType: 'container',
        name: 'container',
        children: [
          {
            type: 'element',
            content: {
              elementType: 'container',
              name: 'container',
              children: [
                {
                  type: 'element',
                  content: { elementType: 'text', name: 'text' },
                },
                {
                  type: 'element',
                  content: { elementType: 'text', name: 'text' },
                },
                {
                  type: 'element',
                  content: { elementType: 'text', name: 'text' },
                },
              ],
            },
          },
        ],
      },
    }

    const lookup: Record<string, { count: number; nextKey: string }> = {}
    createNodesLookup(node, lookup)

    expect(lookup.container.count).toBe(2)
    expect(lookup.container.nextKey).toBe('0')
    expect(lookup.text.count).toBe(3)
    expect(lookup.container.nextKey).toBe('0')
  })

  it('adds zero padding when counting keys', async () => {
    const node: UIDLNode = {
      type: 'element',
      content: {
        elementType: 'container',
        name: 'container',
      },
    }

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
