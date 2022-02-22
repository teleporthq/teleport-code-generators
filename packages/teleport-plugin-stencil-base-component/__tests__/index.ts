import { createStencilComponentPlugin } from '../src/index'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure, ChunkType } from '@teleporthq/teleport-types'
import type { ClassDeclaration, ClassProperty, ExportNamedDeclaration } from '@babel/types'

describe('plugin-stencil-base-component', () => {
  const plugin = createStencilComponentPlugin({
    componentChunkName: 'component-chunk',
    componentDecoratorChunkName: 'decorator-chunk',
  })

  it('creates default void function for props with type as func', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      options: {},
      uidl: component(
        'Test',
        elementNode(
          'container',
          null,
          [],
          null,
          {},
          { click: [{ type: 'propCall', calls: 'onChange' }] }
        ),
        {
          onChange: {
            type: 'func',
          },
        }
      ),
      dependencies: {},
    }
    const { chunks } = await plugin(structure)
    const componentChunk = chunks.find((chunk) => chunk.name === 'component-chunk')
    const contentBody = (
      (componentChunk.content as ExportNamedDeclaration).declaration as ClassDeclaration
    ).body.body
    const classProperty = contentBody.find((body) => body.type === 'ClassProperty') as ClassProperty

    expect(componentChunk).toBeDefined()
    expect(contentBody.length).toBe(2)
    expect(classProperty.value.type).toBe('ArrowFunctionExpression')
  })

  it('outputs two AST chunks with the corresponding chunk names', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      options: {},
      uidl: component('Test', elementNode('container')),
      dependencies: {},
    }
    const result = await plugin(structure)

    // no change to the input UIDL
    expect(JSON.stringify(result.uidl)).toBe(JSON.stringify(structure.uidl))

    // AST chunks created
    expect(result.chunks.length).toBe(2)
    expect(result.chunks[0].type).toBe(ChunkType.AST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('decorator-chunk')
    expect(result.chunks[1].type).toBe(ChunkType.AST)
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('component-chunk')
  })

  it('works with state definitions', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      options: {},
      uidl: component(
        'Test',
        elementNode('container'),
        {},
        {
          isVisible: {
            type: 'boolean',
            defaultValue: false,
          },
        }
      ),
      dependencies: {},
    }
    const result = await plugin(structure)

    // AST chunks created
    expect(result.chunks.length).toBe(2)
    expect(result.chunks[0].type).toBe(ChunkType.AST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('decorator-chunk')
    expect(result.chunks[1].type).toBe(ChunkType.AST)
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('component-chunk')
  })
})
