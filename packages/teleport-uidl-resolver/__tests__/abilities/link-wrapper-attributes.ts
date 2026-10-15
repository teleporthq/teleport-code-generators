import { insertLinks } from '../../src/resolvers/abilities/utils'
import { elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLElementNode, UIDLLinkNode } from '@teleporthq/teleport-types'

/**
 * A styled element that is one link is wrapped in an `<a>`, which takes the
 * attributes that belong to a link — a `data-` hook a script selects the link
 * by among them. A listing card's anatomy (`data-tq-card-slot`, `-size`,
 * `-tone`) describes the card's own box and stays on it: the card's styles
 * answer it on the element that carries the card's class, and the blog's post
 * card — one link to its post — lost every layout and its list rows when the
 * attributes moved to the wrapper.
 */

const postLink: UIDLLinkNode = {
  type: 'url',
  content: { url: staticNode('/blog/post'), newTab: false },
}

function linkedCard(): UIDLElementNode {
  const card = elementNode('container', {
    'data-tq-card-slot': staticNode('root'),
    'data-tq-card-size': staticNode('wide'),
    'data-tq-card-tone': staticNode('default'),
    'data-tq-hook': staticNode('post-card'),
    title: staticNode('A post'),
  })
  card.content.semanticType = 'article'
  card.content.abilities = { link: postLink }
  return card
}

describe('insertLinks — the wrapper of a linked element', () => {
  it("keeps a card's anatomy on the card and hands the link's attributes to the wrapper", () => {
    const page = elementNode('container', {}, [linkedCard()])
    const wrapper = insertLinks(page, {}, false).content.children[0] as UIDLElementNode
    const card = wrapper.content.children[0] as UIDLElementNode

    expect(wrapper.content.elementType).toBe('link')
    expect(Object.keys(wrapper.content.attrs)).toEqual(
      expect.arrayContaining(['data-tq-hook', 'title'])
    )
    expect(Object.keys(wrapper.content.attrs).some((key) => key.startsWith('data-tq-card-'))).toBe(
      false
    )
    expect(card.content.attrs).toEqual({
      'data-tq-card-slot': staticNode('root'),
      'data-tq-card-size': staticNode('wide'),
      'data-tq-card-tone': staticNode('default'),
    })
  })
})
