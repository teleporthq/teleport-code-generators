import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('plugin-css', () => {
  describe('on html template based components', () => {
    const plugin = createPlugin({ templateChunkName: 'template' })
    const componentChunk: ChunkDefinition = {
      name: 'template',
      meta: {
        nodesLookup: {
          container: {
            type: 'element',
            tagName: 'div',
            properties: {},
          },
        },
      },
      fileType: FILE_TYPE.HTML,
      type: CHUNK_TYPE.HAST,
      linkAfter: [],
      content: {},
    }

    it('generates no chunk if no styles exist', async () => {
      const uidlSample = component('CSSPlugin', elementNode('container'))
      const structure: ComponentStructure = {
        uidl: uidlSample,
        options: {},
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
      const element = elementNode('container', {}, [], null, style)
      element.content.key = 'container'
      const uidlSample = component('CSSPlugin', element)

      const structure: ComponentStructure = {
        uidl: uidlSample,
        options: {},
        chunks: [componentChunk],
        dependencies: {},
      }

      const { chunks } = await plugin(structure)

      expect(chunks.length).toBe(2)
      expect(chunks[1].type).toBe('string')
      expect(chunks[1].content).toContain('height: 100px;')

      const nodeReference = componentChunk.meta.nodesLookup.container
      expect(nodeReference.properties.class).toBe('container')
    })
  })

  describe('on jsx-based components', () => {
    const plugin = createPlugin({
      templateStyle: 'jsx',
      declareDependency: 'decorator',
      templateChunkName: 'jsx-component',
      componentDecoratorChunkName: 'component-decorator',
    })
    const componentChunk: ChunkDefinition = {
      name: 'jsx-component',
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
        dynamicRefPrefix: {
          prop: 'props.',
        },
      },
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TSX,
      linkAfter: ['import-local'],
      content: {},
    }

    const decoratorChunk: ChunkDefinition = {
      name: 'component-decorator',
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TSX,
      linkAfter: ['import-local'],
      content: {
        expression: {
          arguments: [
            {
              properties: [],
            },
          ],
        },
      },
    }

    it('generates a string chunk out of the styles, adds the className and the decorator reference', async () => {
      const style = {
        height: staticNode('100px'),
      }
      const element = elementNode('container', {}, [], null, style)
      element.content.key = 'container'
      const uidlSample = component('test', element)

      const structure: ComponentStructure = {
        uidl: uidlSample,
        options: {},
        chunks: [componentChunk, decoratorChunk],
        dependencies: {},
      }

      const { chunks } = await plugin(structure)

      expect(chunks.length).toBe(3)
      const decoratorAST = chunks[1].content

      // AST be crazy...
      const styleReferenceInDecoratorAST =
        decoratorAST.expression.arguments[0].properties[0].value.elements[0].value

      expect(styleReferenceInDecoratorAST).toBe('test.css')
      expect(chunks[2].type).toBe('string')
      expect(chunks[2].content).toContain('height: 100px;')
    })
  })
})
