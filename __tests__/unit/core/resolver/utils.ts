import { generateUniqueKeys, createNodesLookup } from '../../../../src/core/resolver/utils'

describe('generateUniqueKeys', () => {
  it('adds name and key to node', async () => {
    const simpleContentNode: ContentNode = {
      type: 'container',
      name: 'container',
    }

    const lookup = {
      container: {
        count: 1,
        nextKey: '0',
      },
    }

    generateUniqueKeys(simpleContentNode, lookup)

    expect(simpleContentNode.name).toBe('container')
    expect(simpleContentNode.key).toBe('container')
  })

  it('adds name and generate unique key', async () => {
    const contentNode: ContentNode = {
      type: 'container',
      name: 'container',
      children: [
        {
          type: 'container',
          name: 'container',
        },
      ],
    }

    const lookup = {
      container: {
        count: 2,
        nextKey: '0',
      },
    }

    generateUniqueKeys(contentNode, lookup)

    expect(contentNode.name).toBe('container')
    expect(contentNode.key).toBe('container')

    const childNode = contentNode.children[0] as ContentNode
    expect(childNode.name).toBe('container')
    expect(childNode.key).toBe('container1')
  })
})

describe('createNodesLookup', () => {
  it('counts duplicate nodes inside the UIDL', async () => {
    const simpleContentNode: ContentNode = {
      type: 'container',
      name: 'container',
      children: [
        {
          type: 'container',
          name: 'container',
          children: [
            {
              type: 'text',
              name: 'text',
            },
            {
              type: 'text',
              name: 'text',
            },
            {
              type: 'text',
              name: 'text',
            },
          ],
        },
      ],
    }

    const lookup: Record<string, { count: number; nextKey: string }> = {}
    createNodesLookup(simpleContentNode, lookup)

    expect(lookup.container.count).toBe(2)
    expect(lookup.container.nextKey).toBe('0')
    expect(lookup.text.count).toBe(3)
    expect(lookup.container.nextKey).toBe('0')
  })

  it('adds zero padding when counting keys', async () => {
    const simpleContentNode: ContentNode = {
      type: 'container',
      name: 'container',
    }

    const lookup: Record<string, { count: number; nextKey: string }> = {
      container: {
        count: 9,
        nextKey: '0',
      },
    }
    createNodesLookup(simpleContentNode, lookup)

    expect(lookup.container.count).toBe(10)
    expect(lookup.container.nextKey).toBe('00')
  })
})
