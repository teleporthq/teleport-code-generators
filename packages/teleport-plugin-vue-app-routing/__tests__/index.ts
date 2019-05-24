import { createPlugin } from '../src/index'
import {
  component,
  elementNode,
  conditionalNode,
  dynamicNode,
  definition,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

describe('plugin-vue-app-routing', () => {
  const plugin = createPlugin({
    codeChunkName: 'code-chunk',
  })

  it('outputs two AST chunks with the corresponding chunk names', async () => {
    const structure = {
      chunks: [],
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
    expect(result.chunks[0].type).toBe('js')
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].content.length).toBe(2)
    expect(result.chunks[0].name).toBe('code-chunk')

    // Dependencies
    expect(result.dependencies.Vue).toBeDefined()
    expect(result.dependencies.Router).toBeDefined()
  })
})
