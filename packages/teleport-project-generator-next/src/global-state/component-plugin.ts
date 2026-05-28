import { ComponentPlugin, ComponentPluginFactory, UIDLDependency } from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const USE_GLOBAL_STATE_HOOK: UIDLDependency = {
  type: 'local',
  path: '@/global-state-context',
  meta: {
    namedImport: true,
  },
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const createNextGlobalStateComponentPlugin: ComponentPluginFactory<{}> = () => {
  const globalStatePlugin: ComponentPlugin = async (structure) => {
    const { chunks } = structure
    const jsxComponent = chunks.find(
      (chunk) =>
        chunk.name === 'jsx-component' &&
        typeof chunk.content === 'object' &&
        'type' in chunk.content &&
        chunk.content.type === 'VariableDeclaration'
    )
    if (!jsxComponent) {
      return structure
    }

    const globalStateRefs: Array<{ id: string; name: string }> =
      (jsxComponent.meta?.globalStateReferences as Array<{ id: string; name: string }>) || []

    if (globalStateRefs.length === 0) {
      return structure
    }

    const uniqueNames = new Map<string, string>()
    for (const ref of globalStateRefs) {
      if (!uniqueNames.has(ref.id)) {
        uniqueNames.set(ref.id, ref.name)
      }
    }

    const destructuredProps: types.ObjectProperty[] = []
    for (const [, name] of Array.from(uniqueNames)) {
      destructuredProps.push(
        types.objectProperty(types.identifier(name), types.identifier(name), false, true)
      )
      const setterName = `set${capitalize(name)}`
      destructuredProps.push(
        types.objectProperty(
          types.identifier(setterName),
          types.identifier(setterName),
          false,
          true
        )
      )
    }

    const hookCall = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.objectPattern(destructuredProps),
        types.callExpression(types.identifier('useGlobalState'), [])
      ),
    ])

    const componentBody = (
      (
        (jsxComponent.content as types.VariableDeclaration)
          .declarations[0] as types.VariableDeclarator
      ).init as types.ArrowFunctionExpression
    ).body as types.BlockStatement

    const alreadyHasHook = componentBody.body.some(
      (stmt) =>
        stmt.type === 'VariableDeclaration' &&
        stmt.declarations.some(
          (d) =>
            d.init?.type === 'CallExpression' &&
            d.init.callee.type === 'Identifier' &&
            d.init.callee.name === 'useGlobalState'
        )
    )

    if (!alreadyHasHook) {
      componentBody.body.unshift(hookCall)
      structure.dependencies.useGlobalState = { ...USE_GLOBAL_STATE_HOOK }
    }

    return structure
  }

  return globalStatePlugin
}
