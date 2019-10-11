import { createAngularComponentPlugin } from '../src/index'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure, ChunkType } from '@teleporthq/teleport-types'

describe('plugin-angular-base-component', () => {
  const plugin = createAngularComponentPlugin({
    angularTemplateChunkName: 'template-chunk',
    exportClassChunk: 'angular-ts-chunk',
    componentDecoratorChunkName: 'component-decorator',
    tsChunkAfter: ['import-lib', 'import-pack', 'import-local'],
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
    expect(result.chunks.length).toBe(3)
    expect(result.chunks[0].type).toBe(ChunkType.HAST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('template-chunk')
    expect(result.chunks[1].type).toBe(ChunkType.AST)
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('component-decorator')
    expect(result.chunks[2].type).toBe(ChunkType.AST)
    expect(result.chunks[2].content).toBeDefined()
    expect(result.chunks[2].name).toBe('angular-ts-chunk')
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
    expect(result.chunks.length).toBe(3)
    expect(result.chunks[0].type).toBe(ChunkType.HAST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('template-chunk')
    expect(result.chunks[1].type).toBe(ChunkType.AST)
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('component-decorator')
    expect(result.chunks[2].type).toBe(ChunkType.AST)
    expect(result.chunks[2].content).toBeDefined()
    expect(result.chunks[2].name).toBe('angular-ts-chunk')
  })
})
