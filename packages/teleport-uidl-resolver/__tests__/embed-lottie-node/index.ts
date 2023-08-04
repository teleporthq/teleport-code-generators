import { wrapHtmlNode, createEmbedDivWrapperNode } from '../../src/resolvers/embed-node/utils'
import { elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLElementNode, UIDLStyleDefinitions } from '@teleporthq/teleport-types'

describe('wrap html-node element', () => {
  it('wraps a simple element', () => {
    const node = elementNode(
      'html-node',
      {
        html: {
          type: 'raw',
          content: `<blockquote class='twitter-tweet'><p lang='en' dir='ltr'>Feels like the last 20 mins of Don’t Look Up right about now…</p>&mdash; Netflix (@netflix) <a href='https://twitter.com/netflix/status/1593420772948598784?ref_src=twsrc%5Etfw'>November 18, 2022</a></blockquote> <script async src='https://platform.twitter.com/widgets.js'></script>`,
        },
      },
      [],
      undefined,
      {
        width: staticNode('100px'),
      }
    )

    const result = wrapHtmlNode(node, {})
    expect(result.content.elementType).toBe('div')
    expect(result.content.children?.length).toBe(1)
    const childNode = result.content.children?.[0] as UIDLElementNode
    expect(childNode.content.elementType).toBe('html-node')
    expect(childNode.content.attrs?.html.content).toBe(
      `<blockquote class='twitter-tweet'><p lang='en' dir='ltr'>Feels like the last 20 mins of Don’t Look Up right about now…</p>&mdash; Netflix (@netflix) <a href='https://twitter.com/netflix/status/1593420772948598784?ref_src=twsrc%5Etfw'>November 18, 2022</a></blockquote> <script async src='https://platform.twitter.com/widgets.js'></script>`
    )
  })
})

describe('create div', () => {
  it('creates wrapping div', () => {
    const node = elementNode(
      'html-node',
      {
        html: {
          type: 'raw',
          content: `<blockquote class='twitter-tweet'><p lang='en' dir='ltr'>Feels like the last 20 mins of Don’t Look Up right about now…</p>&mdash; Netflix (@netflix) <a href='https://twitter.com/netflix/status/1593420772948598784?ref_src=twsrc%5Etfw'>November 18, 2022</a></blockquote> <script async src='https://platform.twitter.com/widgets.js'></script>`,
        },
      },
      [],
      undefined,
      {
        width: staticNode('100px'),
      }
    )

    const result = createEmbedDivWrapperNode(node)

    expect(result.content.elementType).toBe('div')
    expect(result.content.children?.length).toBe(0)
    expect(result.content.attrs?.html).toBeUndefined()
    expect(result.content.style).toBeDefined()
    expect(Object.keys(result.content.style as UIDLStyleDefinitions).length).toBe(1)
  })
})
