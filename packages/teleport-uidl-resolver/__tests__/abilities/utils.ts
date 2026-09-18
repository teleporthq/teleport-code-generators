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
  GeneratorOptions,
  UIDLDynamicReference,
  UIDLElementNode,
  UIDLExpressionValue,
  UIDLURLLinkNode,
} from '@teleporthq/teleport-types'

const flexProjectStyleSetOptions = (display: string): GeneratorOptions => ({
  projectStyleSet: {
    styleSetDefinitions: {
      'tq-scroll-row': {
        type: 'reusable-project-style-map',
        content: { display: { type: 'static', content: display } },
      },
    },
    fileName: 'style',
    path: '.',
  },
})

describe('insertLink', () => {
  it('wraps a simple element', () => {
    const node = elementNode('container')
    const link = urlMockedDefinition() as UIDLURLLinkNode
    node.content.abilities = { link }

    const result = insertLinks(node, {}, false)
    expect(result.content.elementType).toBe('link')
    expect(result.content.attrs.url.content).toBe(link.content.url.content)
  })

  // Run 10f154ff (Atelier Luzo homepage rail): the page wrote
  // `<div class="surface-media"><a><img></a></div>` and the design system sizes
  // that image through `.surface-media > a > img`. The link came out as
  // `<a><div><img></div></a>`: the extra <div> broke the child chain, the image
  // rendered at its natural 2132 px and blew the rail's card up. The canvas,
  // which does not insert the wrapper, looked right.
  it('a container that is nothing but the link becomes the anchor itself', () => {
    const image = elementNode('image', { src: { type: 'static', content: '/a.jpg' } })
    const bare = elementNode('container', {}, [image])
    bare.content.abilities = { link: urlMockedDefinition() as UIDLURLLinkNode }
    bare.content.attrs = {
      'data-teleport-link-pending': { type: 'static', content: 'Project Details' },
    }
    const well = elementNode('container', {}, [bare])

    const result = insertLinks(well, {}, false)
    const anchor = result.content.children[0] as UIDLElementNode

    expect(anchor.content.elementType).toBe('link')
    expect(anchor.content.attrs.url).toBeDefined()
    expect(anchor.content.attrs['data-teleport-link-pending'].content).toBe('Project Details')
    // The image is the anchor's own child: no element in between.
    expect((anchor.content.children[0] as UIDLElementNode).content.elementType).toBe('image')
    expect(anchor.content.style?.display).toBeUndefined()
  })

  it('still wraps an element that has a box of its own: a style, a class, an event or a runtime attribute', () => {
    const link = urlMockedDefinition() as UIDLURLLinkNode
    const styled = elementNode('container')
    styled.content.style = { padding: { type: 'static', content: '8px' } }
    const classed = elementNode('container')
    classed.content.referencedStyles = {
      card: { type: 'style-map', content: { mapType: 'project-referenced', referenceId: 'card' } },
    } as never
    const bound = elementNode('container')
    bound.content.attrs = { 'data-scroll-bind': { type: 'static', content: '[]' } }
    const clickable = elementNode('container')
    clickable.content.events = { click: [] }

    for (const node of [styled, classed, bound, clickable]) {
      node.content.abilities = { link }
      const result = insertLinks(elementNode('container', {}, [node]), {}, false)
      const wrapper = result.content.children[0] as UIDLElementNode
      expect(wrapper.content.elementType).toBe('link')
      expect((wrapper.content.children[0] as UIDLElementNode).content.elementType).toBe('container')
    }
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

  it('resolves a navlink whose route value carries a folder prefix', () => {
    // A details page's route value is folder-qualified (`add-event/Add-Event`)
    // while the navlink still names the page (`Add-Event`). Matching only on
    // the whole value missed every one of them and silently fabricated
    // `/add-event` — a path with no file behind it.
    const node = elementNode('container')
    const navlink = navlinkMockedDefinition()
    navlink.content.routeName = { type: 'static', content: 'Guild-Details' }
    node.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [{ value: 'guild-details/Guild-Details', pageOptions: { navLink: '/guilds' } }],
        },
      },
      false
    )

    expect(result.content.attrs.transitionTo.content).toBe('/guilds')
  })

  it('does not guess when two folders hold a page of the same name', () => {
    const node = elementNode('container')
    const navlink = navlinkMockedDefinition()
    navlink.content.routeName = { type: 'static', content: 'Details' }
    node.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [
            { value: 'events/Details', pageOptions: { navLink: '/events/detail' } },
            { value: 'guilds/Details', pageOptions: { navLink: '/guilds/detail' } },
          ],
        },
      },
      false
    )

    // Ambiguous → the pre-existing fallback, not an arbitrary pick.
    expect(result.content.attrs.transitionTo.content).toBe('/details')
  })

  it('refuses to link a dynamic route that has no record id to fill it', () => {
    // `/rsvp-event/[id]` is a TEMPLATE. Without a differentiator there is no id
    // to substitute, so neither the template (a literal `[id]` in the address
    // bar) nor the bare prefix (`/rsvp-event`, which matches no file) is
    // navigable. Run 798e2775 shipped the bare prefix in the global footer of
    // all 17 pages.
    const node = elementNode('container')
    const navlink = navlinkMockedDefinition()
    navlink.content.routeName = { type: 'static', content: 'Add-Event' }
    node.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [{ value: 'add-event/Add-Event', pageOptions: { navLink: '/add-event/[id]' } }],
        },
      },
      false
    )

    expect(result.content.attrs.transitionTo.content).toBe('#')
  })

  it('still builds the record URL for a dynamic route WITH a differentiator', () => {
    // The row-scoped case must keep working — it is the reason dynamic routes
    // exist, and it is what the guard above must not touch.
    const node = elementNode('container')
    const navlink = navlinkMockedDefinition()
    navlink.content.routeName = { type: 'static', content: 'Event-Details' }
    navlink.content.differentiatorValue = {
      type: 'dynamic',
      content: { referenceType: 'global', refPath: ['Current User', 'id'] },
    } as never
    node.content.abilities = { link: navlink }

    const result = insertLinks(
      node,
      {
        projectRouteDefinition: {
          type: 'route',
          defaultValue: 'home',
          values: [
            { value: 'event-details/Event-Details', pageOptions: { navLink: '/event-details' } },
          ],
        },
      },
      false
    )

    expect(result.content.attrs.transitionTo).toEqual({
      type: 'expr',
      content: '`/event-details/' + '$' + '{' + 'currentUser?.id}' + '`',
    })
  })

  it('a classed div that is a flex item becomes the link itself when the parent is flex through a project class', () => {
    const child = elementNode('container')
    child.content.abilities = { link: navlinkMockedDefinition() }
    child.content.referencedStyles = {
      TQ_tile: {
        id: 'TQ_tile',
        type: 'style-map',
        content: { mapType: 'project-referenced', referenceId: 'category-tile' },
      },
    }
    const parent = elementNode('container', {}, [child])
    parent.content.referencedStyles = {
      TQ_row: {
        id: 'TQ_row',
        type: 'style-map',
        content: { mapType: 'project-referenced', referenceId: 'tq-scroll-row' },
      },
    }

    const result = insertLinks(parent, flexProjectStyleSetOptions('flex'), false)
    const tile = result.content.children[0] as UIDLElementNode

    // no element in between: the tile is the navlink, with its class and no display of the link's making
    expect(tile.content.elementType).toBe('navlink')
    expect(tile.content.attrs.transitionTo).toBeDefined()
    expect(tile.content.referencedStyles?.TQ_tile).toBeDefined()
    expect(tile.content.style?.display).toBeUndefined()
    expect(tile.content.children ?? []).toHaveLength(0)
  })

  it('keeps scroll-runtime attributes on the styled element, never on the box-less link wrapper', () => {
    // A heading keeps its tag, so it is the case that still gets a wrapper.
    const child = elementNode('text')
    child.content.semanticType = 'h3'
    child.content.abilities = { link: urlMockedDefinition() }
    child.content.attrs = {
      'data-scroll-bind': {
        type: 'static',
        content: '[{"prop":"opacity","at":[0,1],"values":[0,1]}]',
      },
      'data-scroll-bind-rel': { type: 'static', content: '[]' },
      'data-snap-into-view': { type: 'static', content: 'gentle' },
      'data-chapter-window': { type: 'static', content: '0.5-1' },
      'data-analytics': { type: 'static', content: 'cta' },
    }
    const parent = elementNode('container', {}, [child])
    parent.content.style = { display: { type: 'static', content: 'flex' } }

    const result = insertLinks(parent, {}, false)
    const wrapper = result.content.children[0] as UIDLElementNode
    const styledChild = wrapper.content.children[0] as UIDLElementNode

    expect(wrapper.content.style?.display).toEqual({ type: 'static', content: 'contents' })
    expect(Object.keys(wrapper.content.attrs)).not.toEqual(
      expect.arrayContaining([
        'data-scroll-bind',
        'data-scroll-bind-rel',
        'data-snap-into-view',
        'data-chapter-window',
      ])
    )
    expect(styledChild.content.attrs['data-scroll-bind'].content).toContain('opacity')
    expect(styledChild.content.attrs['data-scroll-bind-rel']).toBeDefined()
    expect(styledChild.content.attrs['data-snap-into-view'].content).toBe('gentle')
    expect(styledChild.content.attrs['data-chapter-window'].content).toBe('0.5-1')
    // ordinary data attributes still travel to the anchor
    expect(wrapper.content.attrs['data-analytics'].content).toBe('cta')
    expect(styledChild.content.attrs['data-analytics']).toBeUndefined()
  })

  it('does not mark the link wrapper display:contents when the referenced parent is not flex/grid', () => {
    const child = elementNode('container')
    child.content.abilities = { link: navlinkMockedDefinition() }
    const parent = elementNode('container', {}, [child])
    parent.content.referencedStyles = {
      TQ_row: {
        id: 'TQ_row',
        type: 'style-map',
        content: { mapType: 'project-referenced', referenceId: 'tq-scroll-row' },
      },
    }

    const result = insertLinks(parent, flexProjectStyleSetOptions('block'), false)
    const wrapper = result.content.children[0] as UIDLElementNode

    expect(wrapper.content.elementType).toBe('navlink')
    expect(wrapper.content.style?.display).toBeUndefined()
  })

  it('sees through box-less ancestors to the real flex parent', () => {
    /* The regression this exists for. A linked card almost never sits directly
       inside its grid — it sits inside a repeater, inside a data provider,
       inside a fragment, none of which draw a box. Asking the IMMEDIATE parent
       "are you a flex container?" answered no, the wrapper was left as a normal
       box, and it became the flex item instead of the card: every card lost its
       `flex: 0 0 <width>` and collapsed to content width. The published grid
       stopped matching the editor, which renders no wrapper at all. */
    const card = elementNode('container')
    card.content.abilities = { link: navlinkMockedDefinition() }
    // A card has a box of its own; a bare container would become the anchor itself.
    card.content.style = { flex: { type: 'static', content: '0 0 320px' } }

    const fragment = elementNode('fragment', {}, [card])
    const grid = elementNode('container', {}, [fragment])
    grid.content.referencedStyles = {
      TQ_row: {
        id: 'TQ_row',
        type: 'style-map',
        content: { mapType: 'project-referenced', referenceId: 'tq-scroll-row' },
      },
    }

    const result = insertLinks(grid, flexProjectStyleSetOptions('flex'), false)
    const resolvedFragment = result.content.children[0] as UIDLElementNode
    const linkedCard = resolvedFragment.content.children[0] as UIDLElementNode

    // The grid was seen through the fragment: the card is its item, so the card
    // itself is the navlink and its sizing never leaves it.
    expect(linkedCard.content.elementType).toBe('navlink')
    expect(linkedCard.content.style?.flex).toEqual({ type: 'static', content: '0 0 320px' })
    expect(linkedCard.content.style?.display).toBeUndefined()

    // An element that keeps its tag is wrapped, and that wrapper draws no box.
    const heading = elementNode('text')
    heading.content.semanticType = 'h3'
    heading.content.abilities = { link: navlinkMockedDefinition() }
    const headingGrid = elementNode('container', {}, [elementNode('fragment', {}, [heading])])
    headingGrid.content.referencedStyles = grid.content.referencedStyles
    const wrapped = insertLinks(headingGrid, flexProjectStyleSetOptions('flex'), false)
    const wrapper = (wrapped.content.children[0] as UIDLElementNode).content
      .children[0] as UIDLElementNode
    expect(wrapper.content.elementType).toBe('navlink')
    expect(wrapper.content.style?.display).toEqual({ type: 'static', content: 'contents' })
  })

  it('still ignores box-less ancestors when the real parent is not flex/grid', () => {
    // The transparency walk must not manufacture a flex parent that isn't there.
    const card = elementNode('container')
    card.content.abilities = { link: navlinkMockedDefinition() }

    const fragment = elementNode('fragment', {}, [card])
    const block = elementNode('container', {}, [fragment])
    block.content.referencedStyles = {
      TQ_row: {
        id: 'TQ_row',
        type: 'style-map',
        content: { mapType: 'project-referenced', referenceId: 'tq-scroll-row' },
      },
    }

    const result = insertLinks(block, flexProjectStyleSetOptions('block'), false)
    const resolvedFragment = result.content.children[0] as UIDLElementNode
    const wrapper = resolvedFragment.content.children[0] as UIDLElementNode

    expect(wrapper.content.elementType).toBe('navlink')
    expect(wrapper.content.style?.display).toBeUndefined()
  })
})

/* The link rules generated sites already depend on. Each of them was a fix for a
   broken page at some point (flex items collapsing behind the wrapper in 2020,
   a linked root node in 2024, ids and data attributes lost in 2025), so a change
   to how links are emitted has to keep every one of them. */
describe('link rules that generated sites depend on', () => {
  const linked = (node: UIDLElementNode): UIDLElementNode => {
    node.content.abilities = { link: urlMockedDefinition() as UIDLURLLinkNode }
    return node
  }
  const styledCard = (): UIDLElementNode => {
    const card = elementNode('container')
    card.content.style = { padding: { type: 'static', content: '24px' } }
    return linked(card)
  }
  const withDisplay = (display: string, child: UIDLElementNode): UIDLElementNode => {
    const parent = elementNode('container', {}, [child])
    parent.content.style = { display: { type: 'static', content: display } }
    return parent
  }

  const linkedHeading = (): UIDLElementNode => {
    const heading = elementNode('text')
    heading.content.semanticType = 'h3'
    heading.content.style = { margin: { type: 'static', content: '0' } }
    return linked(heading)
  }

  it.each(['flex', 'inline-flex', 'grid', 'inline-grid'])(
    'a plain div that is an item of a %s parent becomes the link itself: a box-less wrapper cannot take keyboard focus',
    (display) => {
      const result = insertLinks(withDisplay(display, styledCard()), {}, false)
      const card = result.content.children[0] as UIDLElementNode

      expect(card.content.elementType).toBe('link')
      expect(card.content.attrs.url).toBeDefined()
      expect(card.content.style?.padding).toEqual({ type: 'static', content: '24px' })
      // nothing of the link's making on it: no display, no wrapper marker, no element in between
      expect(card.content.style?.display).toBeUndefined()
      expect(card.content.attrs['data-thq-link-wrapper']).toBeUndefined()
      expect(card.content.children ?? []).toHaveLength(0)
    }
  )

  it.each(['flex', 'inline-flex', 'grid', 'inline-grid'])(
    'an element that keeps its tag is wrapped inside a %s parent, and that wrapper draws no box so the element stays the item',
    (display) => {
      const result = insertLinks(withDisplay(display, linkedHeading()), {}, false)
      const wrapper = result.content.children[0] as UIDLElementNode

      expect(wrapper.content.elementType).toBe('link')
      expect(wrapper.content.style?.display).toEqual({ type: 'static', content: 'contents' })
      // it says so, which is how the reset stylesheet finds it to paint a focus ring on its child
      expect(wrapper.content.attrs['data-thq-link-wrapper']).toEqual({
        type: 'static',
        content: 'true',
      })
      const heading = wrapper.content.children[0] as UIDLElementNode
      expect(heading.content.semanticType).toBe('h3')
      expect(heading.content.style?.margin).toEqual({ type: 'static', content: '0' })
    }
  )

  it('a div that becomes the link keeps its id, its data attributes and its scene lanes on itself', () => {
    const card = styledCard()
    card.content.attrs = {
      id: { type: 'static', content: 'featured-card' },
      'data-analytics': { type: 'static', content: 'card' },
      'data-scroll-bind': { type: 'static', content: 'rise-in' },
    }

    const anchor = insertLinks(withDisplay('grid', card), {}, false).content
      .children[0] as UIDLElementNode

    expect(anchor.content.elementType).toBe('link')
    for (const kept of ['id', 'data-analytics', 'data-scroll-bind', 'url']) {
      expect(anchor.content.attrs[kept]).toBeDefined()
    }
  })

  it('a div stays wrapped when it listens to events, carries an attribute an anchor may not, or its parent is not known', () => {
    const clickable = styledCard()
    clickable.content.events = { click: [] }
    const named = styledCard()
    named.content.attrs = { name: { type: 'static', content: 'card' } }

    for (const node of [clickable, named]) {
      const wrapper = insertLinks(withDisplay('flex', node), {}, false).content
        .children[0] as UIDLElementNode
      expect(wrapper.content.elementType).toBe('link')
      expect((wrapper.content.children[0] as UIDLElementNode).content.elementType).toBe('container')
    }
    const rootWrapper = insertLinks(styledCard(), {}, false)
    expect((rootWrapper.content.children[0] as UIDLElementNode).content.elementType).toBe(
      'container'
    )
  })

  it('the wrapper keeps its own box inside a block parent', () => {
    const result = insertLinks(withDisplay('block', styledCard()), {}, false)
    const wrapper = result.content.children[0] as UIDLElementNode

    expect(wrapper.content.elementType).toBe('link')
    expect(wrapper.content.style?.display).toBeUndefined()
    // a wrapper with a box draws its own focus ring and is not marked
    expect(wrapper.content.attrs['data-thq-link-wrapper']).toBeUndefined()
  })

  it('a linked root node is wrapped without a box: its parent is unknown here', () => {
    const wrapper = insertLinks(styledCard(), {}, false)

    expect(wrapper.content.elementType).toBe('link')
    expect(wrapper.content.style?.display).toEqual({ type: 'static', content: 'contents' })
  })

  it('moves the attributes an anchor may carry onto the wrapper and leaves the rest on the element', () => {
    const card = styledCard()
    card.content.attrs = {
      id: { type: 'static', content: 'featured-card' },
      class: { type: 'static', content: 'promo' },
      title: { type: 'static', content: 'Featured' },
      'data-analytics': { type: 'static', content: 'card' },
      'aria-current': { type: 'static', content: 'page' },
      role: { type: 'static', content: 'group' },
      name: { type: 'static', content: 'card' },
    }

    const wrapper = insertLinks(withDisplay('block', card), {}, false).content
      .children[0] as UIDLElementNode
    const element = wrapper.content.children[0] as UIDLElementNode

    for (const moved of ['id', 'class', 'title', 'data-analytics', 'aria-current']) {
      expect(wrapper.content.attrs[moved]).toBeDefined()
      expect(element.content.attrs[moved]).toBeUndefined()
    }
    for (const kept of ['role', 'name']) {
      expect(wrapper.content.attrs[kept]).toBeUndefined()
      expect(element.content.attrs[kept]).toBeDefined()
    }
  })

  it('never turns an element with a meaning of its own into the anchor: it is wrapped and keeps its tag', () => {
    const heading = elementNode('text')
    heading.content.semanticType = 'h2'
    const paragraph = elementNode('text')
    paragraph.content.semanticType = 'p'
    const image = elementNode('image', { src: { type: 'static', content: '/a.jpg' } })
    const listItem = elementNode('container')
    listItem.content.semanticType = 'li'
    const section = elementNode('container')
    section.content.semanticType = 'section'

    for (const node of [heading, paragraph, image, listItem, section]) {
      const { elementType, semanticType } = node.content
      const wrapper = insertLinks(withDisplay('block', linked(node)), {}, false).content
        .children[0] as UIDLElementNode
      const element = wrapper.content.children[0] as UIDLElementNode

      expect(wrapper.content.elementType).toBe('link')
      expect(element.content.elementType).toBe(elementType)
      expect(element.content.semanticType).toBe(semanticType)
    }
  })

  it('a button and a span become the anchor themselves and keep their own styles', () => {
    const button = elementNode('button')
    button.content.style = { padding: { type: 'static', content: '12px' } }
    button.content.attrs = { type: { type: 'static', content: 'button' } }
    const span = elementNode('text')
    span.content.semanticType = 'span'
    span.content.style = { color: { type: 'static', content: 'red' } }

    const asAnchor = insertLinks(linked(button), {}, false)
    expect(asAnchor.content.elementType).toBe('link')
    expect(asAnchor.content.children ?? []).toHaveLength(0)
    expect(asAnchor.content.style?.padding).toEqual({ type: 'static', content: '12px' })
    expect(asAnchor.content.style?.textAlign).toEqual({ type: 'static', content: 'center' })
    expect(asAnchor.content.attrs.type).toBeUndefined()
    expect(asAnchor.content.attrs.url).toBeDefined()

    const textAnchor = insertLinks(linked(span), {}, false)
    expect(textAnchor.content.elementType).toBe('link')
    expect(textAnchor.content.style?.color).toEqual({ type: 'static', content: 'red' })
    expect(textAnchor.content.style?.display).toBeUndefined()
  })

  it('keeps what a motion runtime reads on the element that draws the box, never on the wrapper', () => {
    const card = linkedHeading()
    card.content.attrs = {
      'data-scene-backdrop': { type: 'static', content: 'true' },
      'data-scene-track': { type: 'static', content: 'true' },
      'data-motion-preset': { type: 'static', content: 'slide-up' },
      'data-tq-motion': { type: 'static', content: 'true' },
      'data-scroll-video': { type: 'static', content: 'true' },
      'data-analytics': { type: 'static', content: 'card' },
    }

    const wrapper = insertLinks(withDisplay('flex', card), {}, false).content
      .children[0] as UIDLElementNode
    const element = wrapper.content.children[0] as UIDLElementNode

    for (const kept of [
      'data-scene-backdrop',
      'data-scene-track',
      'data-motion-preset',
      'data-tq-motion',
      'data-scroll-video',
    ]) {
      expect(element.content.attrs[kept]).toBeDefined()
      expect(wrapper.content.attrs[kept]).toBeUndefined()
    }
    expect(wrapper.content.attrs['data-analytics']).toBeDefined()
  })

  it('leaves a link that sits inside another link alone: anchors cannot nest', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const inner = styledCard()
    const outer = linked(elementNode('container', {}, [inner]))
    outer.content.style = { padding: { type: 'static', content: '8px' } }

    const wrapper = insertLinks(outer, {}, false)
    const outerElement = wrapper.content.children[0] as UIDLElementNode
    const innerElement = outerElement.content.children[0] as UIDLElementNode

    expect(wrapper.content.elementType).toBe('link')
    expect(innerElement.content.elementType).toBe('container')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
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
