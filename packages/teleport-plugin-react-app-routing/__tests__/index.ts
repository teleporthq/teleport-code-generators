import { createPlugin } from '../src/index'
import {
  component,
  elementNode,
  conditionalNode,
  dynamicNode,
  definition,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

describe('plugin-react-app-routing', () => {
  const plugin = createPlugin({
    componentChunkName: 'app-routing-chunk',
    domRenderChunkName: 'dom-render-chunk',
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
    expect(result.chunks.length).toBe(2)
    expect(result.chunks[0].type).toBe('js')
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('app-routing-chunk')
    expect(result.chunks[1].type).toBe('js')
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('dom-render-chunk')

    // Dependencies
    expect(result.dependencies.React).toBeDefined()
    expect(result.dependencies.ReactDOM).toBeDefined()
    expect(result.dependencies.Router).toBeDefined()
    expect(result.dependencies.Route).toBeDefined()
  })
})
