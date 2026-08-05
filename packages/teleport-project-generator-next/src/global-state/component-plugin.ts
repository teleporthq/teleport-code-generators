import { ComponentPlugin, ComponentPluginFactory, UIDLDependency } from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { JSIdentifiers, StringUtils } from '@teleporthq/teleport-shared'

export const USE_GLOBAL_STATE_HOOK: UIDLDependency = {
  type: 'local',
  path: '@/global-state-context',
  meta: {
    namedImport: true,
  },
}

/**
 * One entry of the `useGlobalState()` destructuring pattern.
 *
 * The KEY is the context property the provider published — always the declared
 * name, never rewritten. The VALUE is a local binding, so it is sanitised: a
 * global state may legally be named `class`, which cannot be bound directly.
 * Shorthand is kept whenever the two coincide, which is every ordinary name, so
 * the emitted output is unchanged for existing projects.
 */
const destructuredEntry = (contextKey: string): types.ObjectProperty => {
  const localName = JSIdentifiers.createSafeJSIdentifier(contextKey)
  return types.objectProperty(
    JSIdentifiers.isValidPropertyKeyName(contextKey)
      ? types.identifier(contextKey)
      : types.stringLiteral(contextKey),
    types.identifier(localName),
    false,
    localName === contextKey
  )
}

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
      destructuredProps.push(destructuredEntry(name))
      destructuredProps.push(destructuredEntry(StringUtils.createGlobalStateSetterName(name)))
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
