import { createReactAppRoutingPlugin } from '../src/index'
import {
  component,
  elementNode,
  conditionalNode,
  dynamicNode,
  definition,
} from '@teleporthq/teleport-uidl-builders'
import { ChunkType, ComponentStructure, UIDLStateDefinition } from '@teleporthq/teleport-types'

describe('plugin-react-app-routing', () => {
  const plugin = createReactAppRoutingPlugin({
    componentChunkName: 'app-routing-chunk',
    domRenderChunkName: 'dom-render-chunk',
  })

  it('outputs two AST chunks with the corresponding chunk names', async () => {
    const routeDefinition: UIDLStateDefinition = definition('string', 'home')
    routeDefinition.values = [
      { value: 'home', pageOptions: { fileName: 'home', componentName: 'Home', navLink: '/' } },
      {
        value: 'about',
        pageOptions: { fileName: 'about', componentName: 'About', navLink: '/about' },
      },
      {
        value: 'contact',
        pageOptions: { fileName: 'contact', componentName: 'Contact', navLink: '/contact' },
      },
    ]

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
          route: routeDefinition,
        }
      ),
      dependencies: {},
    }
    const result = await plugin(structure)

    // no change to the input UIDL
    expect(JSON.stringify(result.uidl)).toBe(JSON.stringify(structure.uidl))

    // AST chunks created
    expect(result.chunks.length).toBe(2)
    expect(result.chunks[0].type).toBe(ChunkType.AST)
    expect(result.chunks[0].content).toBeDefined()
    expect(result.chunks[0].name).toBe('app-routing-chunk')
    expect(result.chunks[1].type).toBe(ChunkType.AST)
    expect(result.chunks[1].content).toBeDefined()
    expect(result.chunks[1].name).toBe('dom-render-chunk')

    // Dependencies
    expect(result.dependencies.React).toBeDefined()
    expect(result.dependencies.ReactDOM).toBeDefined()
    expect(result.dependencies.Router).toBeDefined()
    expect(result.dependencies.Route).toBeDefined()
  })
})
