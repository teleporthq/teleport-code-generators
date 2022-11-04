import { wrapHtmlNode, createDivNode } from '../../src/resolvers/html-node/utils'
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
          content: `<script src'https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js'></script> <lottie-player src='https://assets6.lottiefiles.com/packages/lf20_gSMVZV7ZdZ.json'  background='transparent'  speed='1'  style='width: 300px; height: 300px;'  loop controls autoplay></lottie-player>`,
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
      `<script src'https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js'></script> <lottie-player src='https://assets6.lottiefiles.com/packages/lf20_gSMVZV7ZdZ.json'  background='transparent'  speed='1'  style='width: 300px; height: 300px;'  loop controls autoplay></lottie-player>`
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
          content: `<script src'https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js'></script> <lottie-player src='https://assets6.lottiefiles.com/packages/lf20_gSMVZV7ZdZ.json'  background='transparent'  speed='1'  style='width: 300px; height: 300px;'  loop controls autoplay></lottie-player>`,
        },
      },
      [],
      undefined,
      {
        width: staticNode('100px'),
      }
    )

    const result = createDivNode(node)

    expect(result.content.elementType).toBe('div')
    expect(result.content.children?.length).toBe(0)
    expect(result.content.attrs?.html).toBeUndefined()
    expect(result.content.style).toBeDefined()
    expect(Object.keys(result.content.style as UIDLStyleDefinitions).length).toBe(1)
  })
})
