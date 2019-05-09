import {
  component,
  elementNode,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'
import {
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { createPlugin } from '../src/index'

describe('Testing the functionality for StyledComponents', () => {
  const plugin = createPlugin()
  const componentChunk: ChunkDefinition = {
    name: 'react-component',
    meta: {
      nodesLookup: {},
    },
    type: 'js',
    linkAfter: ['import-local'],
    content: {},
  }

  it('Should not add styled as dependency', async () => {
    const uidlSample = component('StyledComponents', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [componentChunk],
      dependencies: {},
    }
    const { dependencies } = await plugin(structure)
    expect(Object.keys(dependencies).length).toBe(0)
  })
})
