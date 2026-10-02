import { insertLinks } from '../../src/resolvers/abilities/utils'
import { elementNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLElementNode, UIDLNavLinkNode } from '@teleporthq/teleport-types'

/**
 * The editor exports an element bound to a data source as an ELEMENT whose
 * content is the data provider, rendering the element itself inside it. A
 * details-page link on that element reads its record off the provider, and was
 * dropped: walked as a plain element the wrapper looked empty, so the link
 * inside it was never resolved and the published element did not navigate.
 */

const detailsLink: UIDLNavLinkNode = {
  type: 'navlink',
  content: {
    // tslint:disable-next-line:no-invalid-template-strings
    routeName: { type: 'expr', content: '`/page/${Templates_data_data?.items?.[3]?.slug}`' },
  },
}

const providerWrapping = (child: UIDLElementNode, type: string): UIDLElementNode =>
  ({
    type: 'element',
    content: {
      type,
      content: {
        elementType: 'DataProvider',
        renderPropIdentifier: 'Templates_data_data',
        resourceDefinition: {
          type: 'external-data-source',
          dataSourceId: 'ds-rest',
          tableName: 'data',
          dataSourceType: 'rest-api',
        },
        nodes: {
          success: { type: 'element', content: { elementType: 'fragment', children: [child] } },
        },
      },
      children: [],
    },
  } as unknown as UIDLElementNode)

const linkedChildOf = (page: UIDLElementNode): UIDLElementNode => {
  const wrapper = page.content.children[0] as unknown as {
    content: { content: { nodes: { success: UIDLElementNode } } }
  }
  return wrapper.content.content.nodes.success.content.children[0] as UIDLElementNode
}

describe('insertLinks — an element wrapping a data provider', () => {
  it.each(['data-source-item', 'data-source-list'])(
    'resolves the link of the element a %s renders',
    (type) => {
      const linked = elementNode('text')
      linked.content.abilities = { link: detailsLink }
      const page = elementNode('container', {}, [providerWrapping(linked, type)])

      const resolved = linkedChildOf(insertLinks(page, {}, false))

      expect(resolved.content.elementType).toBe('navlink')
      expect(resolved.content.attrs.transitionTo).toEqual(detailsLink.content.routeName)
    }
  )

  it('leaves an element with no link inside the provider as it was', () => {
    const plain = elementNode('text')
    const page = elementNode('container', {}, [providerWrapping(plain, 'data-source-item')])

    expect(linkedChildOf(insertLinks(page, {}, false)).content.elementType).toBe('text')
  })
})
