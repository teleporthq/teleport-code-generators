import { createReactAppRoutingComponentPlugin } from '../src/index'
import {
  component,
  elementNode,
  conditionalNode,
  dynamicNode,
  definition,
} from '@teleporthq/teleport-uidl-builders'
import { ChunkType, ComponentStructure, UIDLStateDefinition } from '@teleporthq/teleport-types'

describe('plugin-reactnative-app-routing', () => {
  const plugin = createReactAppRoutingComponentPlugin()

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
    expect(result.chunks.length).toBe(1)
    expect(result.chunks[0].type).toBe(ChunkType.AST)
    expect(result.chunks[0].content.length).toBe(3)

    // Dependencies
    expect(result.dependencies.createStackNavigator).toBeDefined()
    expect(result.dependencies.createAppContainer).toBeDefined()
  })
})
