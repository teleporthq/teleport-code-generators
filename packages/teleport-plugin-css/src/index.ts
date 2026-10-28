import { join } from 'path'
import { StringUtils, UIDLUtils, GenericUtils } from '@teleporthq/teleport-shared'
import {
  StyleUtils,
  StyleBuilders,
  HASTUtils,
  HASTBuilders,
  ASTUtils,
  createClassConditionExpression,
} from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLConditionExpressionEntry,
  UIDLDynamicReference,
  UIDLStyleDefinitions,
  ChunkType,
  FileType,
  HastNode,
  UIDLElementNodeReferenceStyles,
  UIDLStyleMediaQueryScreenSizeCondition,
  PluginCSS,
  UIDLElement,
  UIDLElementNode,
  StateDefaultValueTypes,
  PropDefaultValueTypes,
  UIDLStyleInlineAsset,
  UIDLFontAsset,
  UIDLGlobalStateDefinition,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from './style-sheet'
import { createConditionalStatement } from './utils'

interface CSSPluginConfig {
  chunkName: string
  templateChunkName: string
  componentDecoratorChunkName: string
  inlineStyleAttributeKey: string // style vs :style vs ...
  classAttributeName: string // class vs className
  templateStyle: 'html' | 'jsx'
  declareDependency: 'import' | 'decorator' | 'none'
  dynamicVariantPrefix?: string
  staticPropReferences?: boolean
  standaloneHtmlComponents?: boolean
  /**
   * An element's own styles written under its class twice (`.title.title`),
   * the weight of two classes. The Next export's styled-jsx scopes them with a
   * second class and the editor weighs them the same, so an element's own
   * colour beats a two-class combinator like `.hero .title` there; under one
   * class it lost in the static HTML export, which showed another colour.
   */
  doubleElementClass?: boolean
}

const prefixUrlPathsInCss = (css: string, folderPath: string[]): string => {
  const relativePrefix = GenericUtils.localRelativePath(join(...folderPath), './')
  if (!relativePrefix) {
    return css
  }

  return css.replace(/url\(["']?(.*?)["']?\)/g, (match, url) => {
    if (
      url.startsWith('http') ||
      url.startsWith('data:') ||
      url.startsWith('../') ||
      url.startsWith('#')
    ) {
      return match
    }
    return `url("${join(relativePrefix, url)}")`
  })
}

const createCSSPlugin: ComponentPluginFactory<CSSPluginConfig> = (config) => {
  const {
    chunkName = 'style-chunk',
    templateChunkName = 'template-chunk',
    componentDecoratorChunkName = 'component-decorator',
    inlineStyleAttributeKey = 'style',
    classAttributeName = 'class',
    templateStyle = 'html',
    declareDependency = 'none',
    dynamicVariantPrefix,
    staticPropReferences = false,
    standaloneHtmlComponents = false,
    doubleElementClass = false,
  } = config || {}

  const cssPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const {
      node,
      styleSetDefinitions: componentStyleSet = {},
      propDefinitions = {},
      stateDefinitions = {},
    } = uidl
    const {
      projectStyleSet,
      designLanguage: { tokens = {} } = {},
      isRootComponent,
      globalStateDefinitions = {},
      prefixInlineClasses,
    } = options || {}
    const {
      styleSetDefinitions = {},
      fileName: projectStyleSheetName,
      path: projectStyleSheetPath,
    } = projectStyleSet || {}

    if (isRootComponent) {
      if (Object.keys(tokens).length > 0 || Object.keys(styleSetDefinitions).length > 0) {
        dependencies[projectStyleSheetName] = {
          type: 'local',
          path: `${projectStyleSheetPath}${projectStyleSheetName}.${FileType.CSS}`,
          meta: {
            importJustPath: true,
          },
        }
      }

      return structure
    }

    const templateChunk = chunks.find((chunk) => chunk.name === templateChunkName)
    const componentDecoratorChunk = chunks.find(
      (chunk) => chunk.name === componentDecoratorChunkName
    )

    const jsxNodesLookup = templateChunk.meta.nodesLookup as Record<
      string,
      HastNode | types.JSXElement
    >

    const propsPrefix: string = templateChunk.meta.dynamicRefPrefix
      ? ((templateChunk.meta.dynamicRefPrefix as Record<string, unknown>).prop as string)
      : ('' as string)

    const cssMap: string[] = []
    // A doubled element class nests its rule one level down (see `doubleElementClass`).
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number | Record<string, string | number>> }>
    > = {}
    const usedProjectStyleIds: Set<string> = new Set()

    const generateStylesForElementNode = (element: UIDLElement) => {
      const classNamesToAppend: Set<string> = new Set()
      const dynamicVariantsToAppend: Set<string | types.ConditionalExpression> = new Set()
      const {
        style = {},
        key,
        referencedStyles = {},
        attrs = {},
        elementType,
        dependency,
      } = element
      const { dynamicStyleBindings } = element
      const hasDynamicBindings =
        dynamicStyleBindings && Object.keys(dynamicStyleBindings).length > 0

      const root = jsxNodesLookup[key]
      if (!root) {
        return
      }

      // Refer to line 323 all component scoped styles are appended with component name by default
      if (dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          attrs,
          root,
          templateStyle,
          // elementType is used here in-order to target the component name that the class is actually defined.
          // Here we are appendigng to the node where the component is being called.
          getClassName: (styleName: string) =>
            StringUtils.camelCaseToDashCase(elementType + styleName),
        })
      }

      if (
        Object.keys(style).length === 0 &&
        Object.keys(referencedStyles).length === 0 &&
        Object.keys(componentStyleSet).length === 0 &&
        !hasDynamicBindings
      ) {
        return
      }

      // Inline (node-key-derived) classes can share a name with a real project
      // class. When `prefixInlineClasses` is set (AI editor codegen only), tag
      // every inline class so the consumer can tell fake from real by name.
      const className = prefixInlineClasses
        ? `${prefixInlineClasses}${StringUtils.camelCaseToDashCase(key)}`
        : StringUtils.camelCaseToDashCase(key)
      // `&` is the class; doubled it reads `.name.name`. Nested, because JSS
      // escapes a dot written into the class name itself. The element still
      // wears the class once.
      const own = doubleElementClass ? `&.${className}` : '&'

      const { staticStyles, dynamicStyles, tokenStyles } =
        UIDLUtils.splitDynamicAndStaticStyles(style)

      if (Object.keys(staticStyles).length > 0 || Object.keys(tokenStyles).length > 0) {
        const collectedStyles = {
          ...StyleUtils.getContentOfStyleObject(staticStyles),
          ...StyleUtils.getCSSVariablesContentFromTokenStyles(tokenStyles),
        } as Record<string, string | number>

        cssMap.push(
          doubleElementClass
            ? StyleBuilders.createCSSClassWithSelector(className, own, collectedStyles)
            : StyleBuilders.createCSSClass(className, collectedStyles)
        )
        classNamesToAppend.add(className)
      }

      let jsxInlineStyles: Record<string, unknown> | null = null

      if (Object.keys(dynamicStyles).length > 0) {
        for (const styleValue of Object.values(dynamicStyles)) {
          if (
            styleValue.type === 'dynamic' &&
            styleValue.content.referenceType === 'global' &&
            templateChunk.meta.globalReferences
          ) {
            ;(templateChunk.meta.globalReferences as string[]).push(styleValue.content.id)
          }
        }

        /* If dynamic styles are on nested-styles they are unfortunately lost,
          since inline style does not support that */
        if (templateStyle === 'html') {
          const inlineStyles = createDynamicInlineStyle(dynamicStyles)
          const bindingParts = hasDynamicBindings
            ? createDynamicBindingInlineStyle(dynamicStyleBindings)
            : ''
          const combined = bindingParts ? `${inlineStyles}, ${bindingParts}` : inlineStyles
          HASTUtils.addAttributeToNode(root as HastNode, inlineStyleAttributeKey, `{${combined}}`)
        } else {
          jsxInlineStyles = UIDLUtils.transformDynamicStyles(dynamicStyles, (styleValue) =>
            StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
          )
        }
      } else if (hasDynamicBindings && templateStyle === 'html') {
        const bindingParts = createDynamicBindingInlineStyle(dynamicStyleBindings)
        HASTUtils.addAttributeToNode(root as HastNode, inlineStyleAttributeKey, `{${bindingParts}}`)
      }

      if (hasDynamicBindings && templateStyle !== 'html') {
        if (!jsxInlineStyles) {
          jsxInlineStyles = {}
        }
        for (const [cssProperty, binding] of Object.entries(dynamicStyleBindings)) {
          const camelCaseProperty = StringUtils.cssPropertyToInlineStyleKey(cssProperty)
          jsxInlineStyles[camelCaseProperty] = StyleBuilders.createDynamicBindingExpression(binding)
        }
      }

      if (jsxInlineStyles) {
        ASTUtils.addAttributeToJSXTag(
          root as types.JSXElement,
          inlineStyleAttributeKey,
          jsxInlineStyles
        )
      }

      Object.values(referencedStyles).forEach((styleRef: UIDLElementNodeReferenceStyles) => {
        switch (styleRef.content.mapType) {
          case 'inlined': {
            const filtredStyles = UIDLUtils.splitDynamicAndStaticStyles(styleRef.content.styles)
            const collectedStyles = {
              ...StyleUtils.getContentOfStyleObject(filtredStyles.staticStyles),
              ...StyleUtils.getCSSVariablesContentFromTokenStyles(filtredStyles.tokenStyles),
            } as Record<string, string | number>

            const condition = styleRef.content.conditions[0]
            const { conditionType } = condition
            if (conditionType === 'screen-size') {
              const { maxWidth } = condition as UIDLStyleMediaQueryScreenSizeCondition
              if (!mediaStylesMap[String(maxWidth)]) {
                mediaStylesMap[String(maxWidth)] = []
              }
              mediaStylesMap[String(maxWidth)].push({
                [className]: doubleElementClass ? { [own]: collectedStyles } : collectedStyles,
              })
            }

            if (condition.conditionType === 'element-state') {
              cssMap.push(
                StyleBuilders.createCSSClassWithSelector(
                  className,
                  `${own}:${condition.content}`,
                  collectedStyles
                )
              )
            }

            classNamesToAppend.add(className)
            return
          }

          case 'component-referenced': {
            if (styleRef.content.content.type === 'static') {
              classNamesToAppend.add(String(styleRef.content.content.content))
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'prop'
            ) {
              const defaultPropValue =
                propDefinitions[styleRef.content.content.content.id]?.defaultValue

              if (defaultPropValue) {
                propDefinitions[styleRef.content.content.content.id].defaultValue =
                  StringUtils.camelCaseToDashCase(String(defaultPropValue))
              }

              // staticPropReferences flag is only used for just html-code generation.
              // This is used to append the class name to the node where the component is being called.
              // Instead of how frameworks handle them using props at runtime. This makes the props
              // to behave statically during the generation time instead by appending them directly.
              if (staticPropReferences) {
                if (defaultPropValue === undefined || typeof defaultPropValue !== 'string') {
                  return
                }
                classNamesToAppend.add(
                  StringUtils.camelCaseToDashCase(uidl.name + defaultPropValue)
                )
              } else {
                dynamicVariantsToAppend.add(styleRef.content.content.content.id)
              }
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'comp'
            ) {
              if (!componentStyleSet[styleRef.content.content.content.id]) {
                throw new PluginCSS(
                  `Node ${elementType} is referring to a comp style instance ${styleRef.content.content.content.id} which is missing.`
                )
              }
              classNamesToAppend.add(
                StringUtils.camelCaseToDashCase(uidl.name + styleRef.content.content.content.id)
              )
            }

            return
          }

          case 'project-referenced': {
            const { content } = styleRef
            const referedStyle = styleSetDefinitions[content.referenceId]
            if (!referedStyle) {
              return
            }

            usedProjectStyleIds.add(content.referenceId)

            if (styleRef.content.condition) {
              if (templateStyle === 'html') {
                const { value: staticValue, reference, expression } = styleRef.content.condition
                // Class conditions are single-reference flat chains: no writer
                // emits per-entry references or nested groups here. A chain wins
                // over a lone `value`, as in createClassConditionExpression.
                const chain = (expression?.conditions ?? []) as UIDLConditionExpressionEntry[]
                const conditions: UIDLConditionExpressionEntry[] =
                  chain.length === 0 && staticValue !== undefined
                    ? [{ operand: staticValue, operation: '===' }]
                    : chain
                const joiner = expression?.matchingCriteria === 'all' ? '&&' : '||'

                const {
                  content: { referenceType, id, refPath = [] },
                } = reference

                // An operand naming another prop or state compares with the value
                // that one holds for this instance: `undefined` when it holds none
                // or names a value the build cannot read, as at runtime in the JSX
                // exports.
                const resolveOperand = (operand: UIDLConditionExpressionEntry['operand']) => {
                  if (typeof operand !== 'object') {
                    return operand
                  }
                  if (operand.type === 'expr') {
                    return operand.content
                  }
                  const { referenceType: operandType, id: operandId } = operand.content
                  if (operandType === 'prop') {
                    return propDefinitions[operandId]?.defaultValue
                  }
                  if (operandType === 'state') {
                    return stateDefinitions[operandId]?.defaultValue
                  }
                  return undefined
                }

                const isConditionPassing = (
                  value: StateDefaultValueTypes | PropDefaultValueTypes,
                  valueType: string
                ): boolean => {
                  const conditionString = createConditionalStatement(
                    conditions,
                    value,
                    valueType,
                    resolveOperand
                  ).join(` ${joiner} `)
                  // tslint:disable-next-line function-constructor
                  return Boolean(new Function(`return ${conditionString}`)())
                }

                // A condition with no rule, or reading a prop or state deleted
                // after the class was bound, can never hold: the class stays off.
                const hasNoRule = conditions.length === 0

                switch (referenceType) {
                  case 'prop': {
                    const usedProp = propDefinitions[id]
                    if (usedProp === undefined || hasNoRule) {
                      return
                    }

                    // An instance that sets no value of a prop without a default
                    // compares `undefined`, as the props of the JSX exports do.
                    let defaultValue = usedProp.defaultValue
                    for (const path of refPath) {
                      defaultValue = (defaultValue as Record<string, unknown[]>)?.[path]
                    }

                    // If defaultValue is undefined or null after path traversal, use original default
                    defaultValue = defaultValue ?? usedProp.defaultValue

                    if (isConditionPassing(defaultValue, usedProp.type)) {
                      classNamesToAppend.add(styleRef.content.referenceId)
                    }
                    return
                  }
                  case 'state': {
                    const usedState = stateDefinitions[id]
                    if (usedState === undefined || hasNoRule) {
                      return
                    }
                    let defaultValue = usedState.defaultValue
                    for (const path of refPath) {
                      defaultValue = (defaultValue as Record<string, unknown[]>)?.[path]
                    }
                    if (
                      typeof defaultValue === 'object' &&
                      defaultValue !== null &&
                      'type' in (defaultValue as Record<string, unknown>) &&
                      'content' in (defaultValue as Record<string, unknown>)
                    ) {
                      const entry = defaultValue as { type: string; content: unknown }
                      if (entry.type === 'static') {
                        defaultValue = entry.content as typeof defaultValue
                      }
                    }
                    defaultValue = defaultValue ?? usedState.defaultValue

                    if (isConditionPassing(defaultValue, usedState.type)) {
                      classNamesToAppend.add(styleRef.content.referenceId)
                    }
                    return
                  }

                  case 'globalState' as any: {
                    const gsDef = findGlobalStateDefinitionById(id, globalStateDefinitions)
                    if (!gsDef) {
                      classNamesToAppend.add(styleRef.content.referenceId)
                      return
                    }
                    let defaultValue: StateDefaultValueTypes | PropDefaultValueTypes =
                      gsDef.defaultValue as StateDefaultValueTypes
                    for (const path of refPath) {
                      defaultValue = (defaultValue as Record<string, unknown>)?.[
                        path
                      ] as typeof defaultValue
                    }
                    defaultValue = defaultValue ?? (gsDef.defaultValue as StateDefaultValueTypes)
                    if (isConditionPassing(defaultValue, gsDef.type)) {
                      classNamesToAppend.add(styleRef.content.referenceId)
                    }
                    return
                  }

                  default: {
                    classNamesToAppend.add(styleRef.content.referenceId)
                    return
                  }
                }
              } else {
                const { condition } = styleRef.content
                const referenceContent = condition.reference.content
                const referenceType = referenceContent.referenceType
                const nameToAppend =
                  referenceType === 'local' && referenceContent.refPath?.length
                    ? referenceContent.refPath.join('.')
                    : referenceContent.id

                // A prop or state deleted after the class was bound leaves a
                // condition that can never hold: the class stays off.
                let binaryExpressionType = ''
                switch (referenceType) {
                  case 'prop': {
                    if (!propDefinitions[nameToAppend]) {
                      return
                    }
                    binaryExpressionType = propDefinitions[nameToAppend].type
                    break
                  }
                  case 'state': {
                    if (!stateDefinitions[nameToAppend]) {
                      return
                    }
                    binaryExpressionType = stateDefinitions[nameToAppend].type
                    break
                  }
                  case 'local': {
                    // Same flat-leaf contract as the html branch above.
                    const [firstCondition] = (condition.expression?.conditions ??
                      []) as UIDLConditionExpressionEntry[]
                    binaryExpressionType = typeof (firstCondition
                      ? firstCondition.operand
                      : condition.value)
                    break
                  }
                  default: {
                    if ((referenceType as string) === 'globalState') {
                      const gsDef = findGlobalStateDefinitionById(
                        nameToAppend,
                        globalStateDefinitions
                      )
                      if (gsDef) {
                        binaryExpressionType = gsDef.type
                      }
                      break
                    }
                    throw new PluginCSS(
                      `Un-supported reference type ${referenceType} for ${nameToAppend}`
                    )
                  }
                }

                let binaryKey = nameToAppend
                if (referenceType === 'prop') {
                  binaryKey = 'props?.' + nameToAppend
                } else if ((referenceType as string) === 'globalState') {
                  const gsDef = findGlobalStateDefinitionById(nameToAppend, globalStateDefinitions)
                  binaryKey = gsDef ? gsDef.name : nameToAppend
                }

                const classCondition = createClassConditionExpression(condition, {
                  key: binaryKey,
                  type: binaryExpressionType,
                })
                if (!classCondition) {
                  return
                }

                dynamicVariantsToAppend.add(
                  types.conditionalExpression(
                    classCondition,
                    types.stringLiteral(content.referenceId),
                    types.stringLiteral('')
                  )
                )
                return
              }
            } else {
              classNamesToAppend.add(content.referenceId)
            }
            return
          }

          default: {
            throw new PluginCSS(
              `Un-supported style reference ${JSON.stringify(styleRef.content, null, 2)}`
            )
          }
        }
      })

      if (templateStyle === 'html') {
        if (classNamesToAppend.size > 0) {
          HASTUtils.addClassToNode(root as HastNode, Array.from(classNamesToAppend).join(' '))
        }

        if (dynamicVariantsToAppend.size > 1) {
          throw new PluginCSS(`Node ${
            node.content?.name || node.content?.key
          } is using multiple dynamic variants using propDefinitions.
          We can have only one dynamic variant at once`)
        }

        if (dynamicVariantPrefix && dynamicVariantsToAppend.size > 0) {
          HASTUtils.addAttributeToNode(
            root as HastNode,
            dynamicVariantPrefix,
            Array.from(dynamicVariantsToAppend).join(' ')
          )
        }
      } else {
        ASTUtils.addClassStringOnJSXTag(
          root as types.JSXElement,
          Array.from(classNamesToAppend).join(' '),
          classAttributeName,
          Array.from(dynamicVariantsToAppend).map((variant) => {
            const dynamicAttrValueIdentifier: types.Identifier = dynamicVariantPrefix
              ? types.identifier(dynamicVariantPrefix)
              : types.identifier(propsPrefix)

            if (typeof variant === 'string') {
              return types.memberExpression(dynamicAttrValueIdentifier, types.identifier(variant))
            } else {
              // variant is a ConditionalExpression, so return it directly
              return variant
            }
          })
        )
      }
    }

    UIDLUtils.traverseElements(node, generateStylesForElementNode)
    for (const prop of Object.values(propDefinitions)) {
      if (prop.type === 'element' && prop.defaultValue) {
        UIDLUtils.traverseElements(
          prop.defaultValue as UIDLElementNode,
          generateStylesForElementNode
        )
      }
    }

    if (Object.keys(componentStyleSet).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        componentStyleSet,
        cssMap,
        mediaStylesMap,
        (styleName: string) => {
          return StringUtils.camelCaseToDashCase(uidl.name + styleName)
        }
      )
    }

    if (Object.keys(mediaStylesMap).length > 0) {
      cssMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))
    }

    // Handle inline style tag for HTML templates (self-contained fragments)
    if (standaloneHtmlComponents && templateStyle === 'html' && templateChunk) {
      const inlineCssMap: string[] = []
      const hasTokens = Object.keys(tokens).length > 0
      const hasUsedProjectStyles = usedProjectStyleIds.size > 0
      const globalAssets = options.globalAssets || []

      // Get the scoped root class from the template chunk meta
      const scopedRootClass = templateChunk.meta?.scopedRootClass as string | undefined

      // Utility function to scope CSS selectors
      const scopeCssSelectors = (css: string, rootSelector: string): string => {
        // Replace :root with scoped root class
        let scopedCss = css.replace(/:root\s*\{/g, `${rootSelector} {`)

        // Scope regular selectors (but not inside @media or @keyframes)
        // This regex matches CSS rules outside of @ blocks
        scopedCss = scopedCss.replace(/(?:^|\})\s*([^@{}]+?)\s*\{/gm, (match, selectors) => {
          // Skip if it's just closing brace or empty
          if (!selectors || selectors.trim() === '') {
            return match
          }

          // Skip if selector is already the root class
          if (selectors.trim() === rootSelector) {
            return match
          }

          // Handle multiple selectors (comma-separated)
          const scopedSelectors = selectors
            .split(',')
            .map((sel: string) => {
              const trimmedSel = sel.trim()
              // Skip empty selectors
              if (!trimmedSel) {
                return ''
              }
              // Skip if already scoped
              if (trimmedSel.startsWith(rootSelector)) {
                return trimmedSel
              }
              // Replace html/body with root selector
              if (trimmedSel === 'html' || trimmedSel === 'body') {
                return rootSelector
              }
              // For universal selector, scope it
              if (trimmedSel === '*') {
                return `${rootSelector} *`
              }
              // Prefix other selectors with root
              return `${rootSelector} ${trimmedSel}`
            })
            .filter(Boolean)
            .join(', ')

          return match.replace(selectors, scopedSelectors)
        })

        return scopedCss
      }

      // 0. Add reset and default styles from global assets (scoped)
      const inlineStyleAssets = globalAssets.filter(
        (asset): asset is UIDLStyleInlineAsset => asset.type === 'style' && 'content' in asset
      )
      for (const styleAsset of inlineStyleAssets) {
        if (styleAsset.content) {
          const css = scopedRootClass
            ? scopeCssSelectors(styleAsset.content, `.${scopedRootClass}`)
            : styleAsset.content
          inlineCssMap.push(css)
        }
      }

      // 1. Add CSS variables (tokens) - scoped to root class instead of :root
      if (hasTokens) {
        const tokenSelector = scopedRootClass ? `.${scopedRootClass}` : ':root'
        inlineCssMap.push(
          StyleBuilders.createCSSClassWithSelector(
            '@global',
            tokenSelector,
            StyleUtils.getTokensContentFromTokensObject(tokens)
          )
        )
      }

      // 2. Add project-referenced styles that this component uses (scoped)
      if (hasUsedProjectStyles) {
        const usedProjectStyles = Array.from(usedProjectStyleIds)
        // Include exact matches and compound selectors that reference the same base class
        const filteredDefinitions = Object.fromEntries(
          Object.entries(styleSetDefinitions).filter(([key, definition]) => {
            // Include if exact match
            if (usedProjectStyles.includes(key)) {
              return true
            }
            // Include compound selectors where className matches a used project style
            // e.g., "navigation-mobile-overlay.navigation-mobile-overlay-active" has className "navigation-mobile-overlay"
            const className = (definition as { className?: string }).className
            if (className && usedProjectStyles.includes(className)) {
              return true
            }
            // Include compound selectors where the base class (before the dot or space) is a used style
            // e.g., "dashboard-sidebar.collapsed" should be included if "dashboard-sidebar" is used
            // e.g., "dashboard-sidebar.collapsed .sidebar-brand-text" should also be included
            const dotIdx = key.indexOf('.')
            const spaceIdx = key.indexOf(' ')
            if (dotIdx > 0) {
              const baseClass = key.substring(0, dotIdx)
              if (usedProjectStyles.includes(baseClass)) {
                return true
              }
            }
            if (spaceIdx > 0 && dotIdx < 0) {
              const baseClass = key.substring(0, spaceIdx)
              if (usedProjectStyles.includes(baseClass)) {
                return true
              }
            }
            return false
          })
        )
        const projectStylesCssMap: string[] = []
        const projectMediaStylesMap: Record<
          string,
          Array<{ [x: string]: Record<string, string | number> }>
        > = {}
        StyleBuilders.generateStylesFromStyleSetDefinitions(
          filteredDefinitions,
          projectStylesCssMap,
          projectMediaStylesMap,
          (styleName) => styleName
        )
        // Scope the project styles if scoped root class is available
        if (scopedRootClass) {
          const scopedProjectStyles = projectStylesCssMap.map((css) =>
            scopeCssSelectors(css, `.${scopedRootClass}`)
          )
          inlineCssMap.push(...scopedProjectStyles)
        } else {
          inlineCssMap.push(...projectStylesCssMap)
        }
        if (Object.keys(projectMediaStylesMap).length > 0) {
          const mediaStyles = StyleBuilders.generateMediaStyle(projectMediaStylesMap)
          if (scopedRootClass) {
            const scopedMediaStyles = mediaStyles.map((css) =>
              scopeCssSelectors(css, `.${scopedRootClass}`)
            )
            inlineCssMap.push(...scopedMediaStyles)
          } else {
            inlineCssMap.push(...mediaStyles)
          }
        }
      }

      // 3. Add component-specific styles (scoped)
      if (scopedRootClass) {
        // Scope the component CSS
        const scopedCssMap = cssMap.map((css) => scopeCssSelectors(css, `.${scopedRootClass}`))
        inlineCssMap.push(...scopedCssMap)
      } else {
        inlineCssMap.push(...cssMap)
      }

      // 4. Create font link tags from global assets
      const fontAssets = globalAssets.filter(
        (asset): asset is UIDLFontAsset => asset.type === 'font' && 'path' in asset
      )
      const fontLinkNodes: HastNode[] = []
      for (const fontAsset of fontAssets) {
        const linkNode = HASTBuilders.createHTMLNode('link')
        HASTUtils.addAttributeToNode(linkNode, 'rel', 'stylesheet')
        HASTUtils.addAttributeToNode(linkNode, 'href', fontAsset.path)
        if (fontAsset.attrs) {
          for (const [attrKey, attrValue] of Object.entries(fontAsset.attrs)) {
            const value =
              typeof attrValue === 'object' && 'content' in attrValue
                ? String(attrValue.content)
                : String(attrValue)
            HASTUtils.addAttributeToNode(linkNode, attrKey, value)
          }
        }
        fontLinkNodes.push(linkNode)
      }

      // 5. Create <style> node and prepend to HTML (fonts first, then styles)
      if (inlineCssMap.length > 0 || fontLinkNodes.length > 0) {
        const nodesToPrepend: HastNode[] = []

        // Add font links first
        nodesToPrepend.push(...fontLinkNodes)

        // Add style tag with all CSS
        if (inlineCssMap.length > 0) {
          const styleNode = HASTBuilders.createHTMLNode('style')
          const cssContent = HASTBuilders.createTextNode(inlineCssMap.join('\n\n'))
          styleNode.children.push(cssContent)
          nodesToPrepend.push(styleNode)
        }

        ;(templateChunk.content as HastNode).children.unshift(...nodesToPrepend)
      }
    } else if (cssMap.length > 0) {
      // Original behavior: create separate CSS file
      /**
       * Setup an import statement for the styles
       * The name of the file is either in the meta of the component generator
       * or we fallback to the name of the component
       */
      const cssFileName = UIDLUtils.getStyleFileName(uidl)

      if (declareDependency === 'decorator' && componentDecoratorChunk) {
        const decoratorAST = componentDecoratorChunk.content
        // @ts-ignore
        const decoratorParam = decoratorAST.expression.arguments[0]
        ASTUtils.addPropertyToASTObject(decoratorParam, 'styleUrls', [
          `${cssFileName}.${FileType.CSS}`,
        ])
        cssMap.unshift(`:host { \n  display: contents; \n}`)
      }

      if (declareDependency === 'import') {
        dependencies.styles = {
          // styles will not be used in this case as we have importJustPath flag set
          type: 'local',
          path: `./${cssFileName}.${FileType.CSS}`,
          meta: {
            importJustPath: true,
          },
        }
      }

      const folderPath = uidl.outputOptions?.folderPath
      const cssContent =
        folderPath?.length > 0
          ? cssMap.map((css) => prefixUrlPathsInCss(css, folderPath)).join('\n \n')
          : cssMap.join('\n \n')

      chunks.push({
        type: ChunkType.STRING,
        name: chunkName,
        fileType: FileType.CSS,
        content: cssContent,
        linkAfter: [],
      })
    }

    return structure
  }

  return cssPlugin
}

export { createStyleSheetPlugin, createCSSPlugin }

export default createCSSPlugin()

const findGlobalStateDefinitionById = (
  id: string,
  definitions: Record<string, UIDLGlobalStateDefinition>
): UIDLGlobalStateDefinition | undefined => {
  for (const def of Object.values(definitions)) {
    if (def.id === id) {
      return def
    }
  }
  return undefined
}

const createDynamicInlineStyle = (styles: UIDLStyleDefinitions) => {
  return Object.keys(styles)
    .map((styleKey) => {
      return `${styleKey}: ${(styles[styleKey] as UIDLDynamicReference).content.id}`
    })
    .join(', ')
}

const createDynamicBindingInlineStyle = (
  bindings: Record<
    string,
    {
      referenceType: string
      stateKey: string
      defaultValue: string
      contextName?: string
      stateDefinitionId?: string
    }
  >
): string => {
  return Object.entries(bindings)
    .map(([prop, binding]) => {
      const value =
        binding.referenceType === 'ctx' && binding.contextName
          ? `${binding.contextName}.${binding.stateKey}`
          : binding.stateKey
      return `${prop}: ${value} != null ? ${value} : '${binding.defaultValue || ''}'`
    })
    .join(', ')
}
