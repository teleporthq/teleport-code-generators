import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLExternalDependency,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const USE_TRANSLATIONS_HOOK: UIDLExternalDependency = {
  type: 'package',
  path: 'next-intl',
  // next-intl version above to 2.10.0 has issues with next@12 and react@17 which we use.
  // The latest version is 3.20 something, which relies on next/navigation. Which is only available in next@13.
  // Which we don't use. So we are sticking with 2.10.0 for now.'
  version: '2.10.0',
  meta: {
    namedImport: true,
  },
}

export const USE_ROUTER_HOOK: UIDLExternalDependency = {
  type: 'library',
  path: 'next/router',
  version: '^12.1.10',
  meta: {
    namedImport: true,
  },
}

export const createNextInternationalizationPlugin: ComponentPluginFactory<{}> = () => {
  const nextInternationalization: ComponentPlugin = async (structure) => {
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

    for (const localeRef of jsxComponent.meta?.localeReferences || []) {
      const localeRefExpression: types.JSXExpressionContainer | undefined = localeRef.children.find(
        (item): item is types.JSXExpressionContainer => item.type === 'JSXExpressionContainer'
      )
      const reference = localeRefExpression.expression.innerComments[0]?.value?.replace(
        'locale-',
        ''
      )
      const refRawExpression = types.callExpression(
        types.memberExpression(types.identifier('translate'), types.identifier('raw')),
        [types.stringLiteral(reference)]
      )

      localeRef.children = []

      localeRef.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('dangerouslySetInnerHTML'),
          types.jsxExpressionContainer(
            types.objectExpression([
              types.objectProperty(types.identifier('__html'), refRawExpression),
            ])
          )
        )
      )
    }

    const reactHooks: types.VariableDeclaration[] = []
    if (jsxComponent.meta?.localeReferences?.length > 0) {
      const translationsAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('translate'),
          types.callExpression(types.identifier('useTranslations'), [])
        ),
      ])
      reactHooks.push(translationsAST)
      structure.dependencies.useTranslations = USE_TRANSLATIONS_HOOK
    }

    for (const globalRef of jsxComponent.meta.globalReferences || []) {
      switch (globalRef) {
        case 'locale':
        case 'locales': {
          const variableDecleration = types.variableDeclaration('const', [
            types.variableDeclarator(
              types.objectPattern([
                types.objectProperty(
                  types.identifier(globalRef),
                  types.identifier(globalRef),
                  false,
                  true
                ),
              ]),
              types.callExpression(types.identifier('useRouter'), [])
            ),
          ])
          reactHooks.push(variableDecleration)
          structure.dependencies.useRouter = USE_ROUTER_HOOK
          break
        }

        default:
          break
      }
    }

    const componentBody = (
      (
        (jsxComponent.content as types.VariableDeclaration)
          .declarations[0] as types.VariableDeclarator
      ).init as types.ArrowFunctionExpression
    ).body as types.BlockStatement
    componentBody.body.unshift(...reactHooks)

    return structure
  }

  return nextInternationalization
}
