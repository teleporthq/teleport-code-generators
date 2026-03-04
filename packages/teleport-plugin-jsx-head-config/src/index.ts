import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStaticValue,
  UIDLExternalDependency,
} from '@teleporthq/teleport-types'
import { ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'

interface JSXHeadPluginConfig {
  componentChunkName?: string
  configTagIdentifier?: string
  configTagDependencyPath?: string
  configTagDependencyVersion?: string
  isExternalPackage?: boolean
  isDefaultImport?: boolean
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

export const createJSXHeadConfigPlugin: ComponentPluginFactory<JSXHeadPluginConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    configTagIdentifier = 'Helmet',
    configTagDependencyPath = 'react-helmet',
    configTagDependencyVersion = '^6.1.0',
    isExternalPackage = true,
    isDefaultImport = false,
  } = config || {}

  const jsxHeadConfigPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      throw new Error(
        `JSX component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    if (!uidl.seo) {
      return structure
    }

    const reactHooks: types.VariableDeclaration[] = []
    const headASTTags = []
    let translationsAdded = false

    if (uidl.seo.title) {
      const { titleAST, hasTranslation } = generateTitleAST(uidl.seo.title)
      if (hasTranslation) {
        structure.dependencies.useTranslations = USE_TRANSLATIONS_HOOK
        reactHooks.push(getTranslationsAST())
        translationsAdded = true
      }
      headASTTags.push(titleAST)
    }

    if (uidl.seo.metaTags) {
      uidl.seo.metaTags.forEach((tag) => {
        const metaAST = ASTBuilders.createSelfClosingJSXTag('meta')
        Object.keys(tag).forEach((key) => {
          const value = tag[key]
          const { translationUsed } = addAttributeToMetaTag(metaAST, key, value)
          if (translationUsed && !translationsAdded) {
            structure.dependencies.useTranslations = USE_TRANSLATIONS_HOOK
            reactHooks.push(getTranslationsAST())
            translationsAdded = true
          }
        })
        headASTTags.push(metaAST)
      })
    }

    if (uidl.seo.assets) {
      const i18n = structure.options.internationalization
      const hasMultipleLocales = i18n && Object.keys(i18n.languages).length > 1
      let routerAdded = false

      uidl.seo.assets.forEach((asset) => {
        if (asset.type === 'canonical') {
          if (hasMultipleLocales) {
            const { origin, pathname } = parseCanonicalUrl(asset.path)

            // Add useRouter hook for dynamic canonical
            if (!routerAdded) {
              structure.dependencies.useRouter = {
                type: 'library',
                path: 'next/router',
                version: '^12.1.10',
                meta: { namedImport: true },
              }
              reactHooks.push(getRouterAST())
              routerAdded = true
            }

            // Dynamic canonical: for home page (pathname='/'), avoid trailing slash on locale URLs
            // Home: href={`${origin}${router.locale === router.defaultLocale ? '/' : '/' + router.locale}`}
            // Other: href={`${origin}${router.locale === router.defaultLocale ? '' : '/' + router.locale}${pathname}`}
            const isRootPath = pathname === '/'
            const canonicalLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(canonicalLink, 'rel', 'canonical')
            canonicalLink.openingElement.attributes.push(
              types.jsxAttribute(
                types.jsxIdentifier('href'),
                types.jsxExpressionContainer(
                  types.templateLiteral(
                    [
                      types.templateElement({ raw: origin, cooked: origin }, false),
                      types.templateElement(
                        { raw: isRootPath ? '' : pathname, cooked: isRootPath ? '' : pathname },
                        true
                      ),
                    ],
                    [
                      types.conditionalExpression(
                        types.binaryExpression(
                          '===',
                          types.memberExpression(
                            types.identifier('router'),
                            types.identifier('locale')
                          ),
                          types.memberExpression(
                            types.identifier('router'),
                            types.identifier('defaultLocale')
                          )
                        ),
                        types.stringLiteral(isRootPath ? '/' : ''),
                        types.binaryExpression(
                          '+',
                          types.stringLiteral('/'),
                          types.memberExpression(
                            types.identifier('router'),
                            types.identifier('locale')
                          )
                        )
                      ),
                    ]
                  )
                )
              )
            )
            headASTTags.push(canonicalLink)

            // Hreflang tags for each locale
            Object.keys(i18n.languages).forEach((locale) => {
              const hreflangLink = ASTBuilders.createSelfClosingJSXTag('link')
              ASTUtils.addAttributeToJSXTag(hreflangLink, 'rel', 'alternate')
              ASTUtils.addAttributeToJSXTag(hreflangLink, 'hreflang', locale)
              const localePrefix = locale === i18n.main.locale ? '' : '/' + locale
              const hrefPath = pathname === '/' && localePrefix ? '' : pathname
              ASTUtils.addAttributeToJSXTag(hreflangLink, 'href', origin + localePrefix + hrefPath)
              headASTTags.push(hreflangLink)
            })

            // x-default hreflang (points to default locale URL, no prefix)
            const xDefaultLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(xDefaultLink, 'rel', 'alternate')
            ASTUtils.addAttributeToJSXTag(xDefaultLink, 'hreflang', 'x-default')
            ASTUtils.addAttributeToJSXTag(xDefaultLink, 'href', origin + pathname)
            headASTTags.push(xDefaultLink)
          } else {
            // No i18n or single locale — static canonical
            const canonicalLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(canonicalLink, 'rel', 'canonical')
            ASTUtils.addAttributeToJSXTag(canonicalLink, 'href', asset.path)
            headASTTags.push(canonicalLink)
          }
        }
      })
    }

    if (headASTTags.length > 0) {
      const headConfigTag = ASTBuilders.createJSXTag(configTagIdentifier, headASTTags)

      const rootKey = uidl.node.content.key
      // @ts-ignore
      const rootElement = componentChunk.meta.nodesLookup[rootKey] as types.JSXElement

      // Head config added as the first child of the root element
      rootElement.children.unshift(headConfigTag)

      dependencies[configTagIdentifier] = {
        type: isExternalPackage ? 'package' : 'library',
        path: configTagDependencyPath,
        version: configTagDependencyVersion,
        ...(!isDefaultImport && {
          meta: {
            namedImport: true,
          },
        }),
      }
    }

    const componentBody = (
      (
        (componentChunk.content as types.VariableDeclaration)
          .declarations?.[0] as types.VariableDeclarator
      )?.init as types.ArrowFunctionExpression
    )?.body as types.BlockStatement

    if (componentBody?.body) {
      const filteredHooks = reactHooks.filter((hook) => {
        const isRouterDeclaration = hook.declarations.some(
          (declaration) => declaration.id.type === 'Identifier' && declaration.id.name === 'router'
        )
        if (!isRouterDeclaration) {
          return true
        }
        return !componentBody.body.some(
          (statement) =>
            statement.type === 'VariableDeclaration' &&
            statement.declarations.some(
              (declaration) =>
                declaration.id.type === 'Identifier' && declaration.id.name === 'router'
            )
        )
      })
      componentBody.body.unshift(...filteredHooks)
    }
    return structure
  }

  const getTranslationsAST = () => {
    return types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('translate'),
        types.callExpression(types.identifier('useTranslations'), [])
      ),
    ])
  }

  const getRouterAST = () => {
    return types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('router'),
        types.callExpression(types.identifier('useRouter'), [])
      ),
    ])
  }

  const parseCanonicalUrl = (url: string): { origin: string; pathname: string } => {
    try {
      const parsed = new URL(url)
      return { origin: parsed.origin, pathname: parsed.pathname }
    } catch {
      return { origin: url, pathname: '/' }
    }
  }

  const addAttributeToMetaTag = (
    metaTag: types.JSXElement,
    key: string,
    value: string | UIDLStaticValue | UIDLDynamicReference
  ) => {
    if (typeof value === 'string') {
      ASTUtils.addAttributeToJSXTag(metaTag, key, value)
      return { translationUsed: false }
    }

    const isDynamic = value.type === 'dynamic'
    if (!isDynamic) {
      ASTUtils.addAttributeToJSXTag(metaTag, key, value!.content.toString())
      return { translationUsed: false }
    }

    if (value.content.referenceType !== 'prop' && value.content.referenceType !== 'locale') {
      throw new Error(`Only prop and locale references are supported for dynamic meta tags`)
    }

    if (value.content.referenceType === 'prop') {
      let content = `props`
      value.content.refPath?.forEach((pathItem) => {
        content = content.concat(`?.${pathItem}`)
      })

      metaTag.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier(key),
          types.jsxExpressionContainer(types.identifier(content))
        )
      )
      return { translationUsed: false }
    }

    const refRawExpression = types.callExpression(
      types.memberExpression(types.identifier('translate'), types.identifier('raw')),
      [types.stringLiteral(value.content.id)]
    )
    const expression = types.jsxExpressionContainer(refRawExpression)
    metaTag.openingElement.attributes.push(types.jsxAttribute(types.jsxIdentifier(key), expression))
    return { translationUsed: true }
  }

  const generateTitleAST = (title: string | UIDLStaticValue | UIDLDynamicReference) => {
    const titleAST = ASTBuilders.createJSXTag('title')

    if (typeof title === 'string') {
      ASTUtils.addChildJSXText(titleAST, title)
      return { titleAST, hasTranslation: false }
    }

    const isDynamic = title.type === 'dynamic'
    if (!isDynamic) {
      ASTUtils.addChildJSXText(titleAST, title!.content.toString())
      return { titleAST, hasTranslation: false }
    }

    if (title.content.referenceType !== 'prop' && title.content.referenceType !== 'locale') {
      throw new Error(`Only prop and locale references are supported for dynamic titles`)
    }

    if (title.content.referenceType === 'prop') {
      const expresContainer = types.jsxExpressionContainer(
        ASTUtils.generateMemberExpressionASTFromBase(
          types.identifier('props'),
          title.content.refPath || []
        )
      )

      titleAST.children.push(expresContainer)
      return { titleAST, hasTranslation: false }
    }

    const refRawExpression = types.callExpression(
      types.memberExpression(types.identifier('translate'), types.identifier('raw')),
      [types.stringLiteral(title.content.id)]
    )
    const expression = types.jsxExpressionContainer(refRawExpression)

    titleAST.children.push(expression)
    return { titleAST, hasTranslation: true }
  }

  return jsxHeadConfigPlugin
}

export default createJSXHeadConfigPlugin()
