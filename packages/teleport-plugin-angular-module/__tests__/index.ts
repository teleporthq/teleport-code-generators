import { ComponentStructure, ComponentUIDL } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'
import projectUIDL from '../../../examples/test-samples/project-sample.json'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('Testing the functionality for Angular Modules', () => {
  const plugin = createPlugin()

  it('Should add Angular dependencies for root module', async () => {
    const rootUIDL = projectUIDL.root as ComponentUIDL
    const structure: ComponentStructure = {
      uidl: rootUIDL,
      options: {},
      chunks: [],
      dependencies: {},
    }

    const { dependencies, chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(Object.keys(dependencies).length).toBe(5)
    expect(chunks[0].type).toBe(CHUNK_TYPE.AST)
    expect(chunks[0].fileType).toBe(FILE_TYPE.TS)
    expect(chunks[1].type).toBe(CHUNK_TYPE.AST)
    expect(chunks[1].fileType).toBe(FILE_TYPE.TS)
  })

  it('Should add Angular dependencies for component module', async () => {
    const componentUIDL = projectUIDL.components.OneComponent as ComponentUIDL
    const componentPlugin = createPlugin({ moduleType: 'component' })
    const structure: ComponentStructure = {
      uidl: componentUIDL,
      options: { moduleComponents: ['OneComponent'] },
      chunks: [],
      dependencies: {},
    }

    const { dependencies, chunks } = await componentPlugin(structure)

    expect(Object.keys(dependencies).length).toBe(4)
    expect(chunks.length).toBe(1)
    expect(chunks[0].type).toBe(CHUNK_TYPE.AST)
    expect(chunks[0].fileType).toBe(FILE_TYPE.TS)
  })
})
