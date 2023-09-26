import { wrapHtmlNode } from '../../src/resolvers/embed-node/utils'
import { elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLElementNode } from '@teleporthq/teleport-types'

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
    expect(result.content.elementType).toBe('container')
    expect(result.content.children?.length).toBe(1)
    const childNode = result.content.children?.[0] as UIDLElementNode
    expect(childNode.content.elementType).toBe('container')
    expect(childNode.content.children?.length).toBe(1)

    expect(childNode.content.style).toMatchObject({ display: staticNode('contents') })
    const subChildNode = childNode.content.children?.[0] as UIDLElementNode
    expect(subChildNode.content.elementType).toBe('html-node')
    expect(subChildNode.content.attrs?.html.content).toBe(
      `<blockquote class='twitter-tweet'><p lang='en' dir='ltr'>Feels like the last 20 mins of Don’t Look Up right about now…</p>&mdash; Netflix (@netflix) <a href='https://twitter.com/netflix/status/1593420772948598784?ref_src=twsrc%5Etfw'>November 18, 2022</a></blockquote> <script async src='https://platform.twitter.com/widgets.js'></script>`
    )
  })
})
