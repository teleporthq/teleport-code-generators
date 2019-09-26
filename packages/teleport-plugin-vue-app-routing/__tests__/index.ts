import { createVueAppRoutingPlugin } from '../src/index'
import {
  component,
  elementNode,
  conditionalNode,
  dynamicNode,
  definition,
} from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure, ChunkType } from '@teleporthq/teleport-types'

describe('plugin-vue-app-routing', () => {
  const plugin = createVueAppRoutingPlugin({
    codeChunkName: 'code-chunk',
  })

  it('outputs three AST chunks with the corresponding chunk names', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      options: {},
      uidl: component(
        'Test',
        elementNode('Router', {}, [
          conditionalNode(dynamicNode('state', 'route'), elementNode('container'), 'home'),
          conditionalNode(dynamicNode('state', 'route'), elementNode('container'), 'about'),
          conditionalNode(dynamicNode('state', 'route'), elementNode('container'), 'contact'),
        ]),
        {},
        {
          route: definition('string', 'home'),
        }
      ),
      dependencies: {},
    }
    const result = await plugin(structure)

    // no change to the input UIDL
    expect(JSON.stringify(result.uidl)).toBe(JSON.stringify(structure.uidl))

    // AST chunks created
    expect(result.chunks.length).toBe(1)
    expect(result.chunks[0].type).toBe(ChunkType.AST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].content.length).toBe(3)
    expect(result.chunks[0].name).toBe('code-chunk')

    // Dependencies
    expect(result.dependencies.Vue).toBeDefined()
    expect(result.dependencies.Router).toBeDefined()
  })
})
