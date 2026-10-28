import {
  ComponentStructure,
  FileType,
  HastNode,
  HastText,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { component, dynamicNode, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createHTMLBasePlugin } from '../src'

const getMockComponentStructure = (): ComponentStructure => ({
  chunks: [],
  options: {
    extractedResources: {},
  },
  uidl: component('Test', elementNode('container')),
  dependencies: {},
})

describe('plugin-html-base-component', () => {
  it('generated HAST nodes with the UIDL that is passed', async () => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const { chunks } = await htmlComponentPlugin(getMockComponentStructure())
    const htmlChunk = chunks.find((chunk) => chunk.fileType === FileType.HTML)

    expect(chunks.length).toBe(1)
    expect(htmlChunk).toBeDefined()
    expect(htmlChunk?.name).toBe('html-chunk')
  })

  it('adds attributes to the HAST node', async () => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const { chunks } = await htmlComponentPlugin({
      ...getMockComponentStructure(),
      uidl: component(
        'Test',
        elementNode('a', { href: staticNode('/about'), target: staticNode('_blank') }, [
          staticNode('About'),
        ])
      ),
    })

    expect(chunks.length).toEqual(1)
    expect(((chunks[0].content as HastNode).children[0] as HastNode).properties.href).toBe(
      'about.html'
    )
  })

  it('wraps static content inside div tags', async () => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const { chunks } = await htmlComponentPlugin({
      ...getMockComponentStructure(),
      uidl: component('Test', staticNode('Hello') as unknown as UIDLElementNode),
    })

    expect(chunks.length).toEqual(1)
    expect((chunks[0].content as HastNode).children.length).toEqual(1)
  })

  it('Throws error when a external comp is missing', async () => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const plugin = htmlComponentPlugin({
      ...getMockComponentStructure(),
      uidl: component('Test', elementNode('Sample', {}, [], { type: 'local' })),
    })

    await expect(plugin).rejects.toThrow(Error)
  })

  it('Takes default value from props and state, when nodes are using dynamic ref', async () => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const { chunks } = await htmlComponentPlugin({
      ...getMockComponentStructure(),
      uidl: component('Test', elementNode('container', {}, [dynamicNode('prop', 'content')]), {
        content: { type: 'string', defaultValue: 'Hello World' },
      }),
    })

    const hastText = (
      ((chunks[0].content as HastNode).children[0] as HastNode).children[0] as HastNode
    ).children[0] as HastText

    expect(chunks.length).toEqual(1)
    expect(hastText).toBeDefined()
    expect(hastText.type).toBe('text')
    expect(hastText.value).toBe('Hello World')
  })
})

describe('show/hide conditions on a typed prop', () => {
  const shownWhen = (
    propId: string,
    operand: string,
    defaultValue: number | boolean,
    type: 'number' | 'boolean'
  ) =>
    component(
      'Test',
      elementNode('container', {}, [
        {
          type: 'conditional',
          content: {
            reference: { type: 'dynamic', content: { referenceType: 'prop', id: propId } },
            node: elementNode('text', {}, [staticNode('Shown')]),
            condition: { conditions: [{ operation: '===', operand }] },
          },
        },
      ]),
      { [propId]: { type, defaultValue } }
    )

  const renders = async (uidl: ReturnType<typeof component>) => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const { chunks } = await htmlComponentPlugin({ ...getMockComponentStructure(), uidl })
    return JSON.stringify(chunks[0].content).includes('Shown')
  }

  it('compares a number prop with an operand stored as text as numbers', async () => {
    expect(await renders(shownWhen('count', '2', 2, 'number'))).toBe(true)
    expect(await renders(shownWhen('count', '2', 3, 'number'))).toBe(false)
  })

  it('compares a boolean prop with an operand stored as "true" or "false" as booleans', async () => {
    expect(await renders(shownWhen('open', 'true', true, 'boolean'))).toBe(true)
    expect(await renders(shownWhen('open', 'true', false, 'boolean'))).toBe(false)
    expect(await renders(shownWhen('open', 'false', false, 'boolean'))).toBe(true)
    expect(await renders(shownWhen('open', 'false', true, 'boolean'))).toBe(false)
  })
})
