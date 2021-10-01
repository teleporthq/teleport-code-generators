import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import {
  ComponentStructure,
  ChunkDefinition,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { createCSSPlugin } from '../src'
import { setUpHASTChunk, setUpJSXComponentChunk } from './mocks'

describe('plugin-css', () => {
  describe('on html template based components', () => {
    const plugin = createCSSPlugin({ templateChunkName: 'template' })
    const componentChunk: ChunkDefinition = setUpHASTChunk()

    it('generates no chunk if no styles exist', async () => {
      const uidlSample = component('CSSPlugin', elementNode('container'))
      uidlSample.node.content.key = 'element-key'
      componentChunk.meta.nodesLookup = {
        ...componentChunk.meta.nodesLookup,
        'element-key': {
          type: 'element',
          tagName: 'div',
          properties: {},
        },
      }

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
    const plugin = createCSSPlugin({
      templateStyle: 'jsx',
      declareDependency: 'decorator',
      templateChunkName: 'jsx-component',
      componentDecoratorChunkName: 'component-decorator',
    })
    const componentChunk: ChunkDefinition = setUpJSXComponentChunk()

    const decoratorChunk: ChunkDefinition = {
      name: 'component-decorator',
      type: ChunkType.AST,
      fileType: FileType.TSX,
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
