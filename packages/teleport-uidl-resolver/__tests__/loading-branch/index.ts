import { UIDLElement, UIDLNode } from '@teleporthq/teleport-types'
import { resolveNode } from '../../src/utils'
import { HTMLMapping } from '../../src/html-mapping'

/**
 * A data source's loading branch is hoisted from its repeater by reference, so
 * the resolver walks it twice. Resolving twice turned the mapped `img` back into
 * `image` (through the `semanticType` the first pass recorded): a list's loading
 * state drew its pictures as an unknown tag.
 */

const picture = (): UIDLNode =>
  ({
    type: 'element',
    content: { elementType: 'image', name: 'Thumb', attrs: {}, children: [] },
  } as unknown as UIDLNode)

const listWithLoadingPicture = (thumb: UIDLNode): UIDLNode =>
  ({
    type: 'data-source-list',
    content: {
      resourceDefinition: {},
      nodes: {
        success: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [
              {
                type: 'cms-list-repeater',
                content: {
                  elementType: 'cms-list-repeater',
                  nodes: {
                    list: { type: 'element', content: { elementType: 'container', children: [] } },
                    loading: {
                      type: 'element',
                      content: { elementType: 'fragment', name: 'Loading', children: [thumb] },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  } as unknown as UIDLNode)

describe('resolveNode on a hoisted loading branch', () => {
  it('maps every picture of the loading state once, to an img', () => {
    const thumb = picture()
    const list = listWithLoadingPicture(thumb)
    resolveNode(list, { mapping: HTMLMapping } as never)
    expect((thumb.content as UIDLElement).elementType).toBe('img')
  })
})
