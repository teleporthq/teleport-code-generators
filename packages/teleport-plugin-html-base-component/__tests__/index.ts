import {
  ComponentStructure,
  FileType,
  HastNode,
  HastText,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { component, dynamicNode, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createHTMLBasePlugin } from '../src'

describe('plugin-html-base-component', () => {
  const { htmlComponentPlugin } = createHTMLBasePlugin()
  const structure: ComponentStructure = {
    chunks: [],
    options: {},
    uidl: component('Test', elementNode('container')),
    dependencies: {},
  }

  it('generated HAST nodes with the UIDL that is passed', async () => {
    const { chunks } = await htmlComponentPlugin(structure)
    const htmlChunk = chunks.find((chunk) => chunk.fileType === FileType.HTML)

    expect(chunks.length).toBe(1)
    expect(htmlChunk).toBeDefined()
    expect(htmlChunk.name).toBe('html-chunk')
  })

  it('adds attributes to the HAST node', async () => {
    const { chunks } = await htmlComponentPlugin({
      ...structure,
      uidl: component(
        'Test',
        elementNode('a', { href: staticNode('/about'), target: staticNode('_blank') }, [
          staticNode('About'),
        ])
      ),
    })

    expect(chunks.length).toEqual(2)
    expect(((chunks[1].content as HastNode).children[0] as HastNode).properties.href).toBe(
      'about.html'
    )
  })

  it('wraps static content inside div tags', async () => {
    const { chunks } = await htmlComponentPlugin({
      ...structure,
      uidl: component('Test', staticNode('Hello') as unknown as UIDLElementNode),
    })

    expect(chunks.length).toEqual(3)
    expect((chunks[2].content as HastNode).children.length).toEqual(1)
  })

  it('Throws error when a external comp is missing', async () => {
    const plugin = htmlComponentPlugin({
      ...structure,
      uidl: component('Test', elementNode('Sample', {}, [], { type: 'local' })),
    })

    await expect(plugin).rejects.toThrow(Error)
  })

  it('Takes default value from props and state, when nodes are using dynamic ref', async () => {
    const { chunks } = await htmlComponentPlugin({
      ...structure,
      uidl: component('Test', elementNode('container', {}, [dynamicNode('prop', 'content')]), {
        content: { type: 'string', defaultValue: 'Hello World' },
      }),
    })

    const hastText = (
      ((chunks[3].content as HastNode).children[0] as HastNode).children[0] as HastNode
    ).children[0] as HastText

    expect(chunks.length).toEqual(4)
    expect(hastText).toBeDefined()
    expect(hastText.type).toBe('text')
    expect(hastText.value).toBe('Hello World')
  })
})
