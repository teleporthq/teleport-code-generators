import { ComponentStructure, ComponentUIDL } from '@teleporthq/teleport-types'
import stencilAppRouting from '../src/index'
import projectUIDL from '../../../examples/test-samples/project-sample.json'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('Testing the functionality for Stencil Router', () => {
  it('Should generate chunks for routing', async () => {
    const rootUIDL = projectUIDL.root as ComponentUIDL
    const structure: ComponentStructure = {
      uidl: rootUIDL,
      options: {},
      chunks: [],
      dependencies: {},
    }

    const { dependencies, chunks } = await stencilAppRouting(structure)

    expect(chunks.length).toBe(2)
    expect(Object.keys(dependencies).length).toBe(2)
    expect(chunks[0].name).toBe('component-decorator')
    expect(chunks[0].fileType).toBe(FILE_TYPE.TSX)
    expect(chunks[0].type).toBe(CHUNK_TYPE.AST)
    expect(chunks[0].content).toBeDefined()
    expect(chunks[1].name).toBe('jsx-component')
    expect(chunks[1].fileType).toBe(FILE_TYPE.TSX)
    expect(chunks[1].type).toBe(CHUNK_TYPE.AST)
    expect(chunks[1].content).toBeDefined()
  })
})
