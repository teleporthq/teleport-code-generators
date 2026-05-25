import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLDependency,
  UIDLExternalDependency,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const USE_ECOMMERCE_HOOK: UIDLDependency = {
  type: 'local',
  path: '@/ecommerce-context',
  meta: {
    namedImport: true,
  },
}

export const USE_CART_HOOK: UIDLDependency = {
  type: 'local',
  path: '@/ecommerce-context',
  meta: {
    namedImport: true,
  },
}

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

export const NEXT_LINK: UIDLExternalDependency = {
  type: 'library',
  path: 'next/link',
  version: '^12.1.0',
}

export const USE_GLOBAL_CONTEXT_HOOK: UIDLDependency = {
  type: 'local',
  path: '@/global-context',
  meta: {
    namedImport: true,
  },
}

/**
 * Checks if an expression is a member access to `.short` (e.g., `all_languages?.short`)
 */
const isShortMemberAccess = (expr: types.Expression | types.JSXEmptyExpression): boolean => {
  if (types.isOptionalMemberExpression(expr) || types.isMemberExpression(expr)) {
    return types.isIdentifier(expr.property) && expr.property.name === 'short'
  }
  return false
}

/**
 * Checks if `const router = useRouter()` is already declared in the component body
 */
const useRouterAlreadyInBody = (body: types.Statement[]): boolean => {
  return body.some((statement) => {
    return (
      statement.type === 'VariableDeclaration' &&
      statement.declarations.some((declaration) => {
        return declaration.id.type === 'Identifier' && declaration.id.name === 'router'
      })
    )
  })
}

/**
 * Recursively traverses a JSX AST node to find <a href={X?.short}> elements
 * and transforms them to <Link href={router.asPath} locale={X?.short}><a>children</a></Link>
 * for proper Next.js locale switching.
 *
 * Returns true if any transformation was made.
 */
const transformLanguageSwitcherLinks = (node: types.Node): boolean => {
  let transformed = false

  if (types.isJSXElement(node)) {
    const opening = node.openingElement

    if (types.isJSXIdentifier(opening.name) && opening.name.name === 'a') {
      const hrefAttrIndex = opening.attributes.findIndex(
        (attr): attr is types.JSXAttribute =>
          types.isJSXAttribute(attr) &&
          types.isJSXIdentifier(attr.name) &&
          attr.name.name === 'href'
      )

      if (hrefAttrIndex !== -1) {
        const hrefAttr = opening.attributes[hrefAttrIndex] as types.JSXAttribute
        if (
          types.isJSXExpressionContainer(hrefAttr.value) &&
          !types.isJSXEmptyExpression(hrefAttr.value.expression) &&
          isShortMemberAccess(hrefAttr.value.expression)
        ) {
          const localeExpr = hrefAttr.value.expression
          const originalChildren = [...node.children]
          // Drop href/target/rel on the inner anchor — a locale switch should
          // always stay in the same tab and is driven by Next's router, so the
          // new-tab affordances from the UIDL's `newTab: true` would be wrong.
          const innerAnchorStrippedAttrs = new Set(['href', 'target', 'rel'])
          const nonHrefAttrs = opening.attributes.filter(
            (attr) =>
              !(
                types.isJSXAttribute(attr) &&
                types.isJSXIdentifier(attr.name) &&
                innerAnchorStrippedAttrs.has(attr.name.name)
              )
          )

          // Mutate node: change <a> to <Link>
          opening.name = types.jsxIdentifier('Link')
          if (node.closingElement) {
            node.closingElement.name = types.jsxIdentifier('Link')
          }

          // Set Link attributes: href={router.asPath} locale={localeExpr}
          opening.attributes = [
            types.jsxAttribute(
              types.jsxIdentifier('href'),
              types.jsxExpressionContainer(
                types.memberExpression(types.identifier('router'), types.identifier('asPath'))
              )
            ),
            types.jsxAttribute(
              types.jsxIdentifier('locale'),
              types.jsxExpressionContainer(localeExpr)
            ),
          ]

          // Create inner <a> with original children and non-href attributes (Next.js 12 pattern)
          const innerA = types.jsxElement(
            types.jsxOpeningElement(types.jsxIdentifier('a'), nonHrefAttrs, false),
            types.jsxClosingElement(types.jsxIdentifier('a')),
            originalChildren,
            false
          )

          node.children = [innerA]
          return true
        }
      }
    }

    // Traverse JSX element children
    for (const child of node.children) {
      if (transformLanguageSwitcherLinks(child)) {
        transformed = true
      }
    }
    return transformed
  }

  if (types.isJSXFragment(node)) {
    for (const child of node.children) {
      if (transformLanguageSwitcherLinks(child)) {
        transformed = true
      }
    }
    return transformed
  }

  if (types.isJSXExpressionContainer(node) && !types.isJSXEmptyExpression(node.expression)) {
    return transformLanguageSwitcherLinks(node.expression)
  }

  if (types.isCallExpression(node)) {
    for (const arg of node.arguments) {
      if (transformLanguageSwitcherLinks(arg)) {
        transformed = true
      }
    }
    return transformed
  }

  if (types.isArrowFunctionExpression(node)) {
    return transformLanguageSwitcherLinks(node.body)
  }

  if (types.isParenthesizedExpression(node)) {
    return transformLanguageSwitcherLinks(node.expression)
  }

  if (types.isConditionalExpression(node)) {
    if (transformLanguageSwitcherLinks(node.consequent)) {
      transformed = true
    }
    if (transformLanguageSwitcherLinks(node.alternate)) {
      transformed = true
    }
    return transformed
  }

  if (types.isLogicalExpression(node)) {
    if (transformLanguageSwitcherLinks(node.left)) {
      transformed = true
    }
    if (transformLanguageSwitcherLinks(node.right)) {
      transformed = true
    }
    return transformed
  }

  if (types.isBlockStatement(node)) {
    for (const stmt of node.body) {
      if (transformLanguageSwitcherLinks(stmt)) {
        transformed = true
      }
    }
    return transformed
  }

  if (types.isReturnStatement(node) && node.argument) {
    return transformLanguageSwitcherLinks(node.argument)
  }

  return false
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
    structure.dependencies.useTranslations = USE_TRANSLATIONS_HOOK

    if (jsxComponent.meta?.localeReferences?.length > 0 && !useTranslationsInBody) {
      const translationsAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('translate'),
          types.callExpression(types.identifier('useTranslations'), [])
        ),
      ])
      reactHooks.push(translationsAST)
      useTranslationsInBody = true
    }

    const globalCtxProperties: Set<string> = new Set()
    let needsEcommerce = false
    let needsCart = false
    for (const globalRef of jsxComponent.meta.globalReferences || []) {
      switch (globalRef) {
        case 'locale':
        case 'locales':
          globalCtxProperties.add('locale')
          globalCtxProperties.add('locales')
          break
        case 'currentUser':
          globalCtxProperties.add('currentUser')
          break
        case 'userIsLoggedIn':
          globalCtxProperties.add('userIsLoggedIn')
          break
        case 'ecommerce':
          needsEcommerce = true
          break
        case 'cart':
          needsCart = true
          break
        default:
          break
      }
    }

    if (globalCtxProperties.size > 0 && !structure.dependencies.useGlobalContext) {
      const destructuredProps = Array.from(globalCtxProperties).map((prop) =>
        types.objectProperty(types.identifier(prop), types.identifier(prop), false, true)
      )
      const variableDecleration = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.objectPattern(destructuredProps),
          types.callExpression(types.identifier('useGlobalContext'), [])
        ),
      ])
      reactHooks.push(variableDecleration)
      structure.dependencies.useGlobalContext = {
        ...USE_GLOBAL_CONTEXT_HOOK,
      }
    }

    if (needsEcommerce && !structure.dependencies.useEcommerce) {
      const ecommerceHook = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('ecommerce'),
          types.callExpression(types.identifier('useEcommerce'), [])
        ),
      ])
      reactHooks.push(ecommerceHook)
      structure.dependencies.useEcommerce = { ...USE_ECOMMERCE_HOOK }
    }

    if (needsCart && !needsEcommerce && !structure.dependencies.useCart) {
      const cartHook = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('cart'),
          types.callExpression(types.identifier('useCart'), [])
        ),
      ])
      reactHooks.push(cartHook)
      structure.dependencies.useCart = { ...USE_CART_HOOK }
    }

    // Transform language switcher links: <a href={X?.short}> → <Link href={router.asPath} locale={X?.short}><a>...</a></Link>
    if (structure.dependencies.useGlobalContext) {
      const returnStatement = componentBody.body.find(
        (stmt): stmt is types.ReturnStatement => stmt.type === 'ReturnStatement'
      )

      if (returnStatement && returnStatement.argument) {
        const wasTransformed = transformLanguageSwitcherLinks(returnStatement.argument)

        if (wasTransformed) {
          structure.dependencies.Link = { ...NEXT_LINK }
          structure.dependencies.useRouter = { ...USE_ROUTER_HOOK }

          if (!useRouterAlreadyInBody(componentBody.body)) {
            reactHooks.push(
              types.variableDeclaration('const', [
                types.variableDeclarator(
                  types.identifier('router'),
                  types.callExpression(types.identifier('useRouter'), [])
                ),
              ])
            )
          }
        }
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
