import { insertLinks, createLinkNode } from '../../src/resolvers/abilities/utils'
import { elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  urlMockedDefinition,
  navlinkMockedDefinition,
  exprNavlinkMockedDefinition,
  phoneMockedDefinition,
  mailMockedDefinition,
  sectionMockedDefinition,
} from './mocks'
import { UIDLElementNode, UIDLURLLinkNode } from '@teleporthq/teleport-types'

describe('insertLink', () => {
  it('wraps a simple element', () => {
    const node = elementNode('container')
    const link = urlMockedDefinition() as UIDLURLLinkNode
    node.content.abilities = { link }

    const result = insertLinks(node, {}, false)
    expect(result.content.elementType).toBe('link')
    expect(result.content.attrs.url.content).toBe(link.content.url.content)
  })

  it('replaces a child', () => {
    const node = elementNode('container', {}, [
      elementNode('container'),
      elementNode('container'),
      elementNode('container'),
    ])

    const secondChild = node.content.children[1] as UIDLElementNode

    const link = urlMockedDefinition() as UIDLURLLinkNode
    secondChild.content.abilities = { link }

    const result = insertLinks(node, {}, false)
    const secondChildAfterInsertLinks = result.content.children[1] as UIDLElementNode

    expect(secondChildAfterInsertLinks.content.elementType).toBe('link')
    expect(secondChildAfterInsertLinks.content.attrs.url.content).toBe(link.content.url.content)
  })

  it('works with a navlink without page settings', () => {
    const node = elementNode('container', {}, [
      elementNode('container'),
      elementNode('container'),
      elementNode('container'),
    ])

    const secondChild = node.content.children[1] as UIDLElementNode

    const navlink = navlinkMockedDefinition()
    secondChild.content.abilities = { link: navlink }

    const result = insertLinks(node, {}, false)
    const secondChildAfterInsertLinks = result.content.children[1] as UIDLElementNode

    expect(secondChildAfterInsertLinks.content.elementType).toBe('navlink')
    expect(secondChildAfterInsertLinks.content.attrs.transitionTo.content).toBe(
      `/${navlink.content.routeName.content}`
    )
  })

  it('passes through an expr-based navlink routeName unchanged', () => {
    const node = elementNode('container', {}, [elementNode('container'), elementNode('container')])

    const secondChild = node.content.children[1] as UIDLElementNode

    const navlink = exprNavlinkMockedDefinition()
    secondChild.content.abilities = { link: navlink }

    const result = insertLinks(node, {}, false)
    const secondChildAfterInsertLinks = result.content.children[1] as UIDLElementNode

    expect(secondChildAfterInsertLinks.content.elementType).toBe('navlink')
    expect(secondChildAfterInsertLinks.content.attrs.transitionTo).toEqual({
      type: 'expr',
      content: '`/blog/' + '$' + '{' + 'blogPost?.slug}' + '`',
    })
  })

  it('passes through an expr-based navlink even with projectRouteDefinition', () => {
    const node = elementNode('container')

    const navlink = exprNavlinkMockedDefinition()
    node.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [
            {
              value: 'home',
              pageOptions: {
                navLink: '/main-page',
              },
            },
          ],
        },
      },
      false
    )

    expect(result.content.elementType).toBe('navlink')
    expect(result.content.attrs.transitionTo).toEqual({
      type: 'expr',
      content: '`/blog/' + '$' + '{' + 'blogPost?.slug}' + '`',
    })
  })

  it('works with a navlink with page settings', () => {
    const node = elementNode('container', {}, [
      elementNode('container'),
      elementNode('container'),
      elementNode('container'),
    ])

    const secondChild = node.content.children[1] as UIDLElementNode

    const navlink = navlinkMockedDefinition()
    secondChild.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [
            {
              value: 'home',
              pageOptions: {
                navLink: '/main-page',
              },
            },
          ],
        },
      },
      false
    )
    const secondChildAfterInsertLinks = result.content.children[1] as UIDLElementNode

    expect(secondChildAfterInsertLinks.content.elementType).toBe('navlink')
    expect(secondChildAfterInsertLinks.content.attrs.transitionTo.content).toBe(`/main-page`)
  })

  it('emits a template-literal transitionTo when differentiatorValue is set', () => {
    const node = elementNode('container')

    const navlink = navlinkMockedDefinition()
    // Point at the /profile route and append the logged-in user's id, as per
    // the GenericDetailsNavlinkContent contract for the auth profile page.
    navlink.content.routeName = { type: 'static', content: 'profile' }
    navlink.content.differentiatorValue = {
      type: 'dynamic',
      content: {
        referenceType: 'global',
        refPath: ['Current User', 'id'],
      },
    } as never
    node.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [
            {
              value: 'profile',
              pageOptions: { navLink: '/profile' },
            },
          ],
        },
      },
      false
    )

    expect(result.content.elementType).toBe('navlink')
    expect(result.content.attrs.transitionTo).toEqual({
      type: 'expr',
      content: '`/profile/' + '$' + '{' + 'currentUser?.id}' + '`',
    })
  })
})

describe('createLink', () => {
  it('creates a phone link', () => {
    const link = phoneMockedDefinition()
    const result = createLinkNode(link, {})

    expect(result.content.elementType).toBe('link')
    expect(result.content.attrs.url.content).toBe(`tel:${link.content.phone}`)
  })

  it('creates a mail link', () => {
    const link = mailMockedDefinition()
    const result = createLinkNode(link, {})

    expect(result.content.elementType).toBe('link')
    expect(result.content.attrs.url.content).toBe(
      `mailto:${link.content.mail}?subject=${link.content.subject}&body=${link.content.body}`
    )
  })

  it('creates a section link', () => {
    const link = sectionMockedDefinition()
    const result = createLinkNode(link, {})

    expect(result.content.elementType).toBe('link')
    expect(result.content.attrs.url.content).toBe(`#${link.content.section.content}`)
  })
})
