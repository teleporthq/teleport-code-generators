import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLDependency,
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

export const USE_GLOBAL_CONTEXT_HOOK: UIDLDependency = {
  type: 'local',
  path: '../global-context',
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

    const componentBody = (
      (
        (jsxComponent.content as types.VariableDeclaration)
          .declarations[0] as types.VariableDeclarator
      ).init as types.ArrowFunctionExpression
    ).body as types.BlockStatement

    let useTranslationsInBody = useTranslationsAlreadyInBody(componentBody.body)

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
    if (jsxComponent.meta?.localeReferences?.length > 0 && !useTranslationsInBody) {
      const translationsAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('translate'),
          types.callExpression(types.identifier('useTranslations'), [])
        ),
      ])
      reactHooks.push(translationsAST)
      structure.dependencies.useTranslations = USE_TRANSLATIONS_HOOK
      useTranslationsInBody = true
    }

    for (const globalRef of jsxComponent.meta.globalReferences || []) {
      if (structure.dependencies.useGlobalContext) {
        continue
      }

      switch (globalRef) {
        case 'locale':
        case 'locales': {
          const variableDecleration = types.variableDeclaration('const', [
            types.variableDeclarator(
              types.objectPattern([
                // For now, import both locale and locales, even if only one is used.
                types.objectProperty(
                  types.identifier('locale'),
                  types.identifier('locale'),
                  false,
                  true
                ),
                types.objectProperty(
                  types.identifier('locales'),
                  types.identifier('locales'),
                  false,
                  true
                ),
              ]),
              types.callExpression(types.identifier('useGlobalContext'), [])
            ),
          ])
          reactHooks.push(variableDecleration)
          structure.dependencies.useGlobalContext = {
            ...USE_GLOBAL_CONTEXT_HOOK,
          }
          break
        }

        default:
          break
      }
    }

    componentBody.body.unshift(...reactHooks)
    return structure
  }

  const useTranslationsAlreadyInBody = (componentBody: types.Statement[]) => {
    return componentBody.some((statement) => {
      return (
        statement.type === 'VariableDeclaration' &&
        statement.declarations.some((declaration) => {
          return declaration.id.type === 'Identifier' && declaration.id.name === 'translate'
        })
      )
    })
  }
  return nextInternationalization
}
