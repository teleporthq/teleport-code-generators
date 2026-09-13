import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStaticValue,
  UIDLExternalDependency,
} from '@teleporthq/teleport-types'
import { ASTBuilders, ASTUtils, RouteUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { buildStructuredDataScript } from './structured-data-ast'

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
    // Shared by the canonical/og:url branch and the structured-data branch —
    // both may interpolate a route parameter, and the hook is declared once.
    let routerAdded = false

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

      uidl.seo.assets.forEach((asset) => {
        if (asset.type === 'canonical') {
          const canonicalOverride = () => buildCanonicalOverrideExpression(asset.dynamicOverride)
          const { origin, pathname } = parseCanonicalUrl(asset.path)
          const isRootPath = pathname === '/'
          const { staticParts: pathParts, paramNames } = parseDynamicSegments(pathname)
          const isDynamic = paramNames.length > 0

          // Add useRouter hook when needed for locale-aware or dynamic canonical
          if ((hasMultipleLocales || isDynamic) && !routerAdded) {
            structure.dependencies.useRouter = {
              type: 'library',
              path: 'next/router',
              version: '^12.1.10',
              meta: { namedImport: true },
            }
            reactHooks.push(getRouterAST())
            routerAdded = true
          }

          if (hasMultipleLocales) {
            // Dynamic canonical: for home page (pathname='/'), avoid trailing slash on locale URLs
            // Home: href={`${origin}${router.locale === router.defaultLocale ? '/' : '/' + router.locale}`}
            // Other: href={`${origin}${router.locale === router.defaultLocale ? '' : '/' + router.locale}${pathname}`}
            const canonicalLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(canonicalLink, 'rel', 'canonical')

            const localeConditional = types.conditionalExpression(
              types.binaryExpression(
                '===',
                types.memberExpression(types.identifier('router'), types.identifier('locale')),
                types.memberExpression(
                  types.identifier('router'),
                  types.identifier('defaultLocale')
                )
              ),
              types.stringLiteral(isRootPath ? '/' : ''),
              types.binaryExpression(
                '+',
                types.stringLiteral('/'),
                types.memberExpression(types.identifier('router'), types.identifier('locale'))
              )
            )

            let quasis: types.TemplateElement[]
            let expressions: types.Expression[]

            if (isRootPath) {
              quasis = [
                types.templateElement({ raw: origin, cooked: origin }, false),
                types.templateElement({ raw: '', cooked: '' }, true),
              ]
              expressions = [localeConditional]
            } else {
              // For both static and dynamic pathnames: split pathname into static parts
              // interleaved with router.query.paramName expressions
              quasis = [
                types.templateElement({ raw: origin, cooked: origin }, false),
                ...pathParts.map((part, i) =>
                  types.templateElement({ raw: part, cooked: part }, i === pathParts.length - 1)
                ),
              ]
              expressions = [
                localeConditional,
                ...paramNames.map((name) => buildRouterQueryParam(name)),
              ]
            }

            const localeCanonicalOverride = canonicalOverride()
            const localeTemplateExpr = types.templateLiteral(quasis, expressions)
            const canonicalHrefExpr = localeCanonicalOverride
              ? types.logicalExpression('||', localeCanonicalOverride, localeTemplateExpr)
              : localeTemplateExpr
            canonicalLink.openingElement.attributes.push(
              types.jsxAttribute(
                types.jsxIdentifier('href'),
                types.jsxExpressionContainer(canonicalHrefExpr)
              )
            )
            headASTTags.push(canonicalLink)

            // og:url meta tag — mirrors the canonical href
            const ogUrlMeta = ASTBuilders.createSelfClosingJSXTag('meta')
            ASTUtils.addAttributeToJSXTag(ogUrlMeta, 'property', 'og:url')
            const ogUrlQuasis = isRootPath
              ? [
                  types.templateElement({ raw: origin, cooked: origin }, false),
                  types.templateElement({ raw: '', cooked: '' }, true),
                ]
              : [
                  types.templateElement({ raw: origin, cooked: origin }, false),
                  ...pathParts.map((part, i) =>
                    types.templateElement({ raw: part, cooked: part }, i === pathParts.length - 1)
                  ),
                ]
            const ogUrlExpressions: types.Expression[] = [
              types.conditionalExpression(
                types.binaryExpression(
                  '===',
                  types.memberExpression(types.identifier('router'), types.identifier('locale')),
                  types.memberExpression(
                    types.identifier('router'),
                    types.identifier('defaultLocale')
                  )
                ),
                types.stringLiteral(isRootPath ? '/' : ''),
                types.binaryExpression(
                  '+',
                  types.stringLiteral('/'),
                  types.memberExpression(types.identifier('router'), types.identifier('locale'))
                )
              ),
              ...paramNames.map((name) => buildRouterQueryParam(name)),
            ]
            const ogUrlOverride = canonicalOverride()
            const ogUrlTemplateExpr = types.templateLiteral(ogUrlQuasis, ogUrlExpressions)
            const ogUrlContentExpr = ogUrlOverride
              ? types.logicalExpression('||', ogUrlOverride, ogUrlTemplateExpr)
              : ogUrlTemplateExpr
            ogUrlMeta.openingElement.attributes.push(
              types.jsxAttribute(
                types.jsxIdentifier('content'),
                types.jsxExpressionContainer(ogUrlContentExpr)
              )
            )
            headASTTags.push(ogUrlMeta)

            // Hreflang tags for each locale
            Object.keys(i18n.languages).forEach((locale) => {
              const hreflangLink = ASTBuilders.createSelfClosingJSXTag('link')
              ASTUtils.addAttributeToJSXTag(hreflangLink, 'rel', 'alternate')
              ASTUtils.addAttributeToJSXTag(hreflangLink, 'hrefLang', locale)
              const localePrefix = locale === i18n.main.locale ? '' : '/' + locale
              const hrefPath = pathname === '/' && localePrefix ? '' : pathname
              addDynamicHrefAttribute(hreflangLink, origin + localePrefix + hrefPath)
              headASTTags.push(hreflangLink)
            })

            // x-default hreflang (points to default locale URL, no prefix)
            const xDefaultLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(xDefaultLink, 'rel', 'alternate')
            ASTUtils.addAttributeToJSXTag(xDefaultLink, 'hrefLang', 'x-default')
            addDynamicHrefAttribute(xDefaultLink, origin + pathname)
            headASTTags.push(xDefaultLink)
          } else if (isDynamic) {
            // No i18n but has dynamic params — needs router.query interpolation
            const canonicalLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(canonicalLink, 'rel', 'canonical')
            addDynamicHrefAttribute(canonicalLink, asset.path, canonicalOverride())
            headASTTags.push(canonicalLink)

            // og:url meta tag — mirrors the canonical href
            const ogUrlMeta = ASTBuilders.createSelfClosingJSXTag('meta')
            ASTUtils.addAttributeToJSXTag(ogUrlMeta, 'property', 'og:url')
            addDynamicContentAttribute(ogUrlMeta, asset.path, canonicalOverride())
            headASTTags.push(ogUrlMeta)
          } else {
            // No i18n or single locale — static canonical (an entity override,
            // when present, turns the attribute into `{override || 'path'}`)
            const canonicalLink = ASTBuilders.createSelfClosingJSXTag('link')
            ASTUtils.addAttributeToJSXTag(canonicalLink, 'rel', 'canonical')
            addDynamicHrefAttribute(canonicalLink, asset.path, canonicalOverride())
            headASTTags.push(canonicalLink)

            // og:url meta tag — mirrors the canonical href
            const ogUrlMeta = ASTBuilders.createSelfClosingJSXTag('meta')
            ASTUtils.addAttributeToJSXTag(ogUrlMeta, 'property', 'og:url')
            addDynamicContentAttribute(ogUrlMeta, asset.path, canonicalOverride())
            headASTTags.push(ogUrlMeta)
          }
        }
      })
    }

    if (uidl.seo.structuredData && uidl.seo.structuredData.length > 0) {
      uidl.seo.structuredData.forEach((entry) => {
        const { scriptTag, usesTranslations, usesRouter } = buildStructuredDataScript(entry)
        if (usesTranslations && !translationsAdded) {
          structure.dependencies.useTranslations = USE_TRANSLATIONS_HOOK
          reactHooks.push(getTranslationsAST())
          translationsAdded = true
        }
        // The script interpolated a route parameter (a details page's own URL in
        // a BreadcrumbList), so it needs the same `useRouter` hook the dynamic
        // canonical uses. `routerAdded` is shared with the canonical branch
        // above so the hook is declared exactly once.
        if (usesRouter && !routerAdded) {
          structure.dependencies.useRouter = {
            type: 'library',
            path: 'next/router',
            version: '^12.1.10',
            meta: { namedImport: true },
          }
          reactHooks.push(getRouterAST())
          routerAdded = true
        }
        headASTTags.push(scriptTag)
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
      // Temporarily replace ${...} patterns to prevent URL encoding by the URL constructor
      const placeholders: Array<{ placeholder: string; original: string }> = []
      let placeholderIndex = 0
      const safeUrl = url.replace(/\$\{([^}]+)\}/g, (match) => {
        const placeholder = `__DYNAMIC_${placeholderIndex++}__`
        placeholders.push({ placeholder, original: match })
        return placeholder
      })
      const parsed = new URL(safeUrl)
      let pathname = parsed.pathname
      // Restore original ${...} patterns
      placeholders.forEach(({ placeholder, original }) => {
        pathname = pathname.replace(placeholder, original)
      })
      return { origin: parsed.origin, pathname }
    } catch {
      return { origin: url, pathname: '/' }
    }
  }

  /**
   * Splits a string into the literal text around its route parameters.
   * Understands both `${slug}` and the Next.js `/[id]` form a details page's
   * canonical URL actually carries — see `RouteUtils.parseDynamicPathSegments`.
   * e.g. "/news/[slug]" => { staticParts: ["/news/", ""], paramNames: ["slug"] }
   */
  const parseDynamicSegments = RouteUtils.parseDynamicPathSegments

  const buildRouterQueryParam = (paramName: string): types.MemberExpression => {
    return types.memberExpression(
      types.memberExpression(types.identifier('router'), types.identifier('query')),
      types.identifier(paramName)
    )
  }

  /** `['blogPost', 'canonicalUrl']` -> `props?.blogPost?.canonicalUrl` */
  const buildPropsChainExpression = (refPath: string[]): types.Expression => {
    return refPath.reduce<types.Expression>(
      (acc, pathItem) =>
        types.optionalMemberExpression(acc, types.identifier(pathItem), false, true),
      types.identifier('props')
    )
  }

  const buildLiteralExpression = (value: string | number | boolean): types.Expression => {
    if (typeof value === 'number') {
      return types.numericLiteral(value)
    }
    if (typeof value === 'boolean') {
      return types.booleanLiteral(value)
    }
    return types.stringLiteral(value)
  }

  /**
   * A canonical asset's `dynamicOverride` is a per-entity prop reference (a
   * details-page row's own canonical URL). Returns the `props?.…` chain to
   * `||`-wrap around the page-level href expression, or null when the asset
   * has no usable override. Built fresh on every call — the canonical href and
   * the og:url mirror each need their own AST nodes.
   */
  const buildCanonicalOverrideExpression = (
    dynamicOverride?: UIDLDynamicReference
  ): types.Expression | null => {
    if (
      dynamicOverride?.type !== 'dynamic' ||
      dynamicOverride.content.referenceType !== 'prop' ||
      !dynamicOverride.content.refPath?.length
    ) {
      return null
    }
    return buildPropsChainExpression(dynamicOverride.content.refPath)
  }

  /**
   * Adds an href attribute to a JSX tag. If the href contains ${paramName} patterns,
   * generates a template literal with router.query.paramName expressions.
   * Otherwise, adds a static string attribute.
   */
  const addDynamicAttributeToTag = (
    tag: types.JSXElement,
    attrName: string,
    value: string,
    overrideExpr?: types.Expression | null
  ): void => {
    const { staticParts, paramNames } = parseDynamicSegments(value)
    if (paramNames.length === 0 && !overrideExpr) {
      ASTUtils.addAttributeToJSXTag(tag, attrName, value)
      return
    }
    const baseExpr: types.Expression =
      paramNames.length === 0
        ? types.stringLiteral(value)
        : types.templateLiteral(
            staticParts.map((part, i) =>
              types.templateElement({ raw: part, cooked: part }, i === staticParts.length - 1)
            ),
            paramNames.map((name) => buildRouterQueryParam(name))
          )
    // The override wraps the WHOLE fallback expression: an entity-supplied URL
    // must never be spliced into the page-level template (locale prefixes,
    // route params) — it either fully replaces the href or is absent.
    const attrExpr = overrideExpr ? types.logicalExpression('||', overrideExpr, baseExpr) : baseExpr
    tag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier(attrName), types.jsxExpressionContainer(attrExpr))
    )
  }

  const addDynamicHrefAttribute = (
    tag: types.JSXElement,
    href: string,
    overrideExpr?: types.Expression | null
  ): void => {
    addDynamicAttributeToTag(tag, 'href', href, overrideExpr)
  }

  const addDynamicContentAttribute = (
    tag: types.JSXElement,
    content: string,
    overrideExpr?: types.Expression | null
  ): void => {
    addDynamicAttributeToTag(tag, 'content', content, overrideExpr)
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
      const propChain = buildPropsChainExpression(value.content.refPath || [])
      // `fallback` keeps the attribute meaningful for rows that don't carry the
      // field (e.g. a robots meta inheriting the page-level default) — without
      // it an undefined prop renders a content-less tag.
      const fallback = 'fallback' in value.content ? value.content.fallback : undefined
      const contentExpression =
        fallback === undefined || fallback === null
          ? propChain
          : types.logicalExpression('??', propChain, buildLiteralExpression(fallback))

      metaTag.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier(key),
          types.jsxExpressionContainer(contentExpression)
        )
      )
      return { translationUsed: false }
    }

    const refRawExpression = types.callExpression(
      types.memberExpression(types.identifier('translate'), types.identifier('raw')),
      // Sanitized exactly like the messages-file keys — see
      // `StringUtils.sanitizeTranslationKey`.
      [types.stringLiteral(StringUtils.sanitizeTranslationKey(value.content.id))]
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
      // Sanitized exactly like the messages-file keys — see
      // `StringUtils.sanitizeTranslationKey`.
      [types.stringLiteral(StringUtils.sanitizeTranslationKey(title.content.id))]
    )
    const expression = types.jsxExpressionContainer(refRawExpression)

    titleAST.children.push(expression)
    return { titleAST, hasTranslation: true }
  }

  return jsxHeadConfigPlugin
}

export default createJSXHeadConfigPlugin()
