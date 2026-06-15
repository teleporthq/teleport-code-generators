import { insertLinks, createLinkNode } from '../../src/resolvers/abilities/utils'
import { elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  urlMockedDefinition,
  navlinkMockedDefinition,
  exprNavlinkMockedDefinition,
  phoneMockedDefinition,
  mailMockedDefinition,
  sectionMockedDefinition,
  linkTypePropDefinitions,
  linkTypePropDynamicReference,
} from './mocks'
import {
  UIDLDynamicReference,
  UIDLElementNode,
  UIDLExpressionValue,
  UIDLURLLinkNode,
} from '@teleporthq/teleport-types'

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

describe('insertLink with link-type prop', () => {
  it('wraps a container element with a link when link ability references a link-type prop', () => {
    const node = elementNode('container')
    node.content.abilities = { link: linkTypePropDynamicReference() }

    const result = insertLinks(node, {}, false, undefined, linkTypePropDefinitions())

    // The wrapper should be a link (maps to <a> by default, <Link> in Next.js via project mapping)
    expect(result.content.elementType).toBe('prop-link')

    // url is resolved tolerantly: a link prop can be bound to a plain string
    // (e.g. an Airtable URL column) instead of a `{ url, newTab }` object, so we
    // use the string directly when it is one and fall back to `.url` otherwise.
    const url = result.content.attrs.url as UIDLExpressionValue
    expect(url.type).toBe('expr')
    expect(url.content).toContain(`typeof props.cardLink === 'string'`)
    expect(url.content).toContain(`props.cardLink?.['url']`)

    // target and rel should be expr ternaries for newTab
    expect(result.content.attrs.target.type).toBe('expr')
    expect(result.content.attrs.target.content).toContain('newTab')
    expect(result.content.attrs.rel.type).toBe('expr')
    expect(result.content.attrs.rel.content).toContain('noreferrer noopener')

    // The original container should be a child of the link wrapper
    const child = result.content.children[0] as UIDLElementNode
    expect(child.content.elementType).toBe('container')
  })

  it('replaces a button element inline with link for link-type prop', () => {
    const node = elementNode('button')
    node.content.abilities = { link: linkTypePropDynamicReference() }

    const result = insertLinks(node, {}, false, undefined, linkTypePropDefinitions())

    // Button should be replaced inline (not wrapped)
    expect(result.content.elementType).toBe('prop-link')
    expect(result.content.semanticType).toBe('')

    const url = result.content.attrs.url as UIDLExpressionValue
    expect(url.type).toBe('expr')
    expect(url.content).toContain(`typeof props.cardLink === 'string'`)
    expect(url.content).toContain(`props.cardLink?.['url']`)
  })

  it('replaces a text span element inline with link for link-type prop', () => {
    const node = elementNode('text')
    node.content.semanticType = 'span'
    node.content.abilities = { link: linkTypePropDynamicReference() }

    const result = insertLinks(node, {}, false, undefined, linkTypePropDefinitions())

    expect(result.content.elementType).toBe('prop-link')
    expect(result.content.semanticType).toBe('')

    const url = result.content.attrs.url as UIDLExpressionValue
    expect(url.type).toBe('expr')
    expect(url.content).toContain(`typeof props.cardLink === 'string'`)
    expect(url.content).toContain(`props.cardLink?.['url']`)
  })

  it('falls back to existing dynamic link behavior when prop is not link-type', () => {
    const node = elementNode('container')
    const dynamicLink: UIDLDynamicReference = {
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: 'someStringProp',
      },
    }
    node.content.abilities = { link: dynamicLink }

    // Pass prop definitions where the referenced prop is type 'string', not 'link'
    const result = insertLinks(node, {}, false, undefined, {
      someStringProp: { type: 'string', defaultValue: '/about' },
    })

    // Should fall through to existing dynamic link handling (navlink with transitionTo)
    expect(result.content.elementType).toBe('navlink')
    expect(result.content.attrs.transitionTo.type).toBe('dynamic')
    // Should NOT have refPath since it's the old behavior
    expect(
      (result.content.attrs.transitionTo as UIDLDynamicReference).content.refPath
    ).toBeUndefined()
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
