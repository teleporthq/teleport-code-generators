import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'

describe('plugin-react-css-modules', () => {
  const plugin = createPlugin()
  const componentChunk: ChunkDefinition = {
    name: 'react-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: '',
            },
            attributes: [],
          },
        },
      },
    },
    type: 'js',
    linkAfter: ['import-local'],
    content: {},
  }

  it('generates no chunk if no styles exist', async () => {
    const uidlSample = component('CSSModules', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
  })

  it('generates a string chunk out of the styles and adds the className', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('container', {}, [], { type: 'package' }, style)
    element.content.key = 'container'
    const uidlSample = component('CSSModules', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].content).toContain('height: 100px;')

    const nodeReference = componentChunk.meta.nodesLookup.container
    expect(nodeReference.openingElement.attributes.length).toBe(1)

    const classNameAttr = nodeReference.openingElement.attributes[0]
    expect(classNameAttr.name.name).toBe('className')
    expect(classNameAttr.value.expression.name).toBe('styles.container')
  })
})
