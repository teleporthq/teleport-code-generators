import * as types from '@babel/types'
import { ChunkType, ComponentStructure } from '@teleporthq/teleport-types'
import { createNextGlobalStateComponentPlugin } from '../src/global-state/component-plugin'

// A component can reference one global state by its id in one place (a text
// binding) and by its name in another (a condition's operand). Both resolve to
// the same context key, and a `useGlobalState()` pattern that binds a name twice
// does not compile: "the name `x` is defined multiple times".

const buildStructure = (references: Array<{ id: string; name: string }>): ComponentStructure => {
  const component = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('AdminSidebarNav'),
      types.arrowFunctionExpression([], types.blockStatement([]))
    ),
  ])
  return {
    uidl: { name: 'AdminSidebarNav', node: { type: 'element', content: {} } },
    options: {},
    dependencies: {},
    chunks: [
      {
        name: 'jsx-component',
        type: ChunkType.AST,
        fileType: 'js',
        content: component,
        linkAfter: [],
        meta: { globalStateReferences: references },
      },
    ],
  } as unknown as ComponentStructure
}

const boundNames = (structure: ComponentStructure): string[] => {
  const component = structure.chunks[0].content as types.VariableDeclaration
  const body = (
    (component.declarations[0] as types.VariableDeclarator).init as types.ArrowFunctionExpression
  ).body as types.BlockStatement
  const hook = body.body[0] as types.VariableDeclaration
  const pattern = hook.declarations[0].id as types.ObjectPattern
  return pattern.properties.map(
    (property) => ((property as types.ObjectProperty).value as types.Identifier).name
  )
}

describe('global state component plugin', () => {
  it('binds a state referenced by its id and by its name once', async () => {
    const plugin = createNextGlobalStateComponentPlugin()
    const structure = await plugin(
      buildStructure([
        { id: 'e7cd0847-uuid', name: 'teleportAdminPendingReviews' },
        { id: 'teleportAdminPendingReviews', name: 'teleportAdminPendingReviews' },
        { id: 'e7cd0847-uuid', name: 'teleportAdminPendingReviews' },
        { id: 'f1aa0000-uuid', name: 'teleportAdminOrdersToShip' },
        { id: 'teleportAdminOrdersToShip', name: 'teleportAdminOrdersToShip' },
      ])
    )

    expect(boundNames(structure)).toEqual([
      'teleportAdminPendingReviews',
      'setTeleportAdminPendingReviews',
      'teleportAdminOrdersToShip',
      'setTeleportAdminOrdersToShip',
    ])
    expect(structure.dependencies.useGlobalState).toBeDefined()
  })
})
