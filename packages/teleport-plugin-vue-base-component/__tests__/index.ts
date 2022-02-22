import { createVueComponentPlugin } from '../src/index'
import { structure } from './mocks'
import { ChunkType, ComponentStructure } from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import type { ExportDefaultDeclaration, ObjectExpression, ObjectProperty } from '@babel/types'

describe('vue-base-component-plugin', () => {
  const plugin = createVueComponentPlugin({
    vueJSChunkName: 'component-js',
    vueTemplateChunkName: 'component-html',
  })

  it('outputs two AST chunks with the corresponding chunk names', async () => {
    const result = await plugin(structure)

    // no change to the input UIDL
    expect(JSON.stringify(result.uidl)).toBe(JSON.stringify(structure.uidl))

    // AST chunks created
    expect(result.chunks.length).toBe(2)
    expect(result.chunks[0].type).toBe(ChunkType.HAST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('component-html')
    expect(result.chunks[1].type).toBe(ChunkType.AST)
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('component-js')

    // Dependencies
    expect(Object.keys(result.dependencies).length).toBe(0)
  })

  it('creates default void function for props with type as func', async () => {
    const defaultFuncStructure: ComponentStructure = {
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
            defaultValue: '() => {}',
          },
        }
      ),
      dependencies: {},
    }
    const { chunks } = await plugin(defaultFuncStructure)
    const jsChunk = chunks.find((chunk) => chunk.name === 'component-js')
    const properties = (
      (jsChunk.content as ExportDefaultDeclaration).declaration as ObjectExpression
    ).properties
    const defaultFunc = ((properties[1] as ObjectProperty).value as ObjectExpression).properties
    const funcProperty = ((defaultFunc[0] as ObjectProperty).value as ObjectExpression)
      .properties[0] as ObjectProperty

    expect(jsChunk).toBeDefined()
    expect(funcProperty.value.type).toBe('ArrowFunctionExpression')
  })
})
