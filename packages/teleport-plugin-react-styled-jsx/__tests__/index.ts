import {
  component,
  elementNode,
  staticNode,
  conditionalNode,
  dynamicNode,
  definition,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'

describe('plugin-react-styled-jsx', () => {
  const plugin = createPlugin()
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: 'div',
            },
            attributes: [],
          },
          children: [],
        },
        group: {
          openingElement: {
            name: {
              name: 'Fragment',
            },
            attributes: [],
          },
          children: [],
        },
      },
      dynamicRefPrefix: {
        prop: 'props.',
      },
    },
    type: 'js',
    linkAfter: ['import-local'],
    content: {},
  }

  it('adds nothing on the AST if not styles are defined', async () => {
    const uidlSample = component('StyledJSX', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const oldStructure = JSON.stringify(structure)
    await plugin(structure)
    const newStructure = JSON.stringify(structure)

    expect(oldStructure).toBe(newStructure)
  })

  it('adds a <style> element', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('div', {}, [], null, style)
    element.content.key = 'container'
    const group = elementNode('Fragment', {}, [element])
    group.content.key = 'group'
    const uidlSample = component('StyledJSX', group)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
    const nodeReference = componentChunk.meta.nodesLookup.group
    expect(nodeReference.children.length).toBe(1)

    const styledTag = nodeReference.children[0]

    expect(styledTag.openingElement.name.name).toBe('style')
    expect(styledTag.children[0].expression.quasis[0].value.raw).toContain('height: 100px')
  })

  it('add <style> tag to first element node if the root is non-element', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode(
      'div',
      {},
      [dynamicNode('prop', 'title'), staticNode('I am Title')],
      null,
      style
    )
    element.content.key = 'container'
    const uidlSample = component(
      'Component',
      conditionalNode(dynamicNode('prop', 'title'), element, false),
      { title: definition('string', 'Hello') },
      {}
    )

    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [componentChunk],
      dependencies: {},
      options: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
    const nodeReference = componentChunk.meta.nodesLookup.container
    expect(nodeReference.children.length).toBe(1)

    const styledTag = nodeReference.children[0]

    expect(styledTag.openingElement.name.name).toBe('style')
    expect(styledTag.children[0].expression.quasis[0].value.raw).toContain('height: 100px')
  })
})
