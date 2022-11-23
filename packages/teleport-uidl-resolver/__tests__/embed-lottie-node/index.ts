import {
  wrapHtmlLottieNode,
  createEmbedDivWrapperNode,
  createLottieDivWrapperNode,
} from '../../src/resolvers/embed-lottie-node/utils'
import { elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLElementNode, UIDLStyleDefinitions } from '@teleporthq/teleport-types'
import { create } from 'domain'

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

    const result = wrapHtmlLottieNode(node, {})
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

describe('wrap lottie element', () => {
  it('wraps a simple element', () => {
    const node = elementNode(
      'lottie-node',
      {
        src: {
          type: 'static',
          content: 'https://assets9.lottiefiles.com/datafiles/gUENLc1262ccKIO/data.json',
        },
        autoplay: {
          type: 'static',
          content: 'true',
        },
        id: {
          type: 'static',
          content: 'id_123',
        },
      },
      [],
      undefined,
      {
        width: staticNode('100px'),
        height: staticNode('100px'),
      }
    )

    const result = wrapHtmlLottieNode(node, {})
    expect(result.content.elementType).toBe('div')
    expect(result.content.children?.length).toBe(1)
    expect(result.content.children?.length).toBe(1)
    expect(result.content.style?.width.content).toBe('100px')
    expect(result.content.style?.height.content).toBe('100px')
    expect(result.content.attrs?.id.content).toBe('id_123')

    const childNode = result.content.children?.[0] as UIDLElementNode
    expect(childNode.content.elementType).toBe('lottie-node')
    expect(childNode.content.style).toStrictEqual({})
    expect(childNode.content.attrs?.src.content).toBe(
      `https://assets9.lottiefiles.com/datafiles/gUENLc1262ccKIO/data.json`
    )
    expect(childNode.content.attrs?.autoplay.content).toBe('true')
  })
})

describe('create div', () => {
  it('creates wrapping div for lottie node', () => {
    const node = elementNode(
      'lottie-node',
      {
        src: {
          type: 'static',
          content: 'https://assets9.lottiefiles.com/datafiles/gUENLc1262ccKIO/data.json',
        },
        autoplay: {
          type: 'static',
          content: 'true',
        },
        id: {
          type: 'static',
          content: 'id_123',
        },
      },
      [],
      undefined,
      {
        width: staticNode('100px'),
        height: staticNode('100px'),
      }
    )

    const result = createLottieDivWrapperNode(node)

    expect(result.content.elementType).toBe('div')
    expect(result.content.children?.length).toBe(0)
    expect(result.content.attrs?.src).toBeUndefined()
    expect(result.content.style?.width.content).toBe('100px')
    expect(result.content.style?.height.content).toBe('100px')
    expect(result.content.attrs?.id.content).toBe('id_123')
  })
})
