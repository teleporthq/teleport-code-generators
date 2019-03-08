import { generateFallbackNamesAndKeys } from '../../../../src/core/resolver/utils'
import { UIDLTypes } from '../../../../src'

describe('generateFallbackNamesAndKeys', () => {
  it('adds name and key to node', async () => {
    const simpleContentNode: UIDLTypes.ContentNode = {
      type: 'container',
    }

    const lookup = {
      container: {
        count: 1,
        nextKey: '0',
      },
    }

    generateFallbackNamesAndKeys(simpleContentNode, lookup)

    expect(simpleContentNode.name).toBe('container')
    expect(simpleContentNode.key).toBe('container')
  })

  it('adds name and generate unique key', async () => {
    const contentNode: UIDLTypes.ContentNode = {
      type: 'container',
      children: [
        {
          type: 'container',
        },
      ],
    }

    const lookup = {
      container: {
        count: 2,
        nextKey: '0',
      },
    }

    generateFallbackNamesAndKeys(contentNode, lookup)

    expect(contentNode.name).toBe('container')
    expect(contentNode.key).toBe('container')

    const childNode = contentNode.children[0] as UIDLTypes.ContentNode
    expect(childNode.name).toBe('container')
    expect(childNode.key).toBe('container1')
  })
})
