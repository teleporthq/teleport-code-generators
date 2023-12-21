/*
  teleport-plugin-react-jss

  Plugin is responsible for generating styles from
  - Styles defined on individual nodes.
  - Styles defined in the project's global stylesheet.
  - Styles present in the component style sheeet.
*/

import * as types from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ASTUtils,
  ASTBuilders,
  ParsedASTNode,
  StyleBuilders,
} from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  PluginReactJSS,
  UIDLElementNodeInlineReferencedStyle,
} from '@teleporthq/teleport-types'
import {
  generateStylesFromStyleObj,
  createStylesHookDecleration,
  generateProjectStyleSheet,
  convertMediaAndStylesToObject,
} from './utils'
import { createStyleSheetPlugin } from './style-sheet'

interface JSSConfig {
  styleChunkName?: string
  importChunkName?: string
  componentChunkName: string
  jssDeclarationName?: string
  classAttributeName?: string
  styleObjectImportName?: string
}
const EXPORT_IDENTIFIER = 'createUseStyles'

export const createReactJSSPlugin: ComponentPluginFactory<JSSConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    importChunkName = 'import-local',
    styleChunkName = 'jss-style-definition',
    jssDeclarationName = 'useStyles',
    classAttributeName = 'className',
    styleObjectImportName = 'classes',
  } = config || {}

  const reactJSSPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { projectStyleSet } = options
    const { node, styleSetDefinitions: componentStyleSheet = {}, propDefinitions = {} } = uidl

    const componentChunk = chunks.find((chunkItem) => chunkItem.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jssStyleMap: Array<Record<string, unknown>> = []
    const mediaStyles: Record<string, Array<{ [x: string]: Record<string, string | number> }>> = {}
    const tokensUsed: string[] = []

    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
    const jsxNodesLookup: Record<string, types.JSXElement> =
      (componentChunk.meta.nodesLookup as Record<string, types.JSXElement>) || {}
    let isProjectReferenced: boolean = false
    const propsUsed: string[] = []

    UIDLUtils.traverseElements(node, (element) => {
      const { style, key, referencedStyles, dependency, attrs = {} } = element
      if (dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          attrs,
          key,
          jsxNodesLookup,
          getClassName,
        })
      }

      if (
        Object.keys(style || {}).length === 0 &&
        Object.keys(referencedStyles || {}).length === 0
      ) {
        return
      }

      const jsxTag = jsxNodesLookup[key] as types.JSXElement
      if (!jsxTag) {
        return
      }

      const className = getClassName(key)
      const classNamesToAppend: Set<
        types.MemberExpression | types.Identifier | types.StringLiteral
      > = new Set()
      const nodeStyleIdentifier = types.memberExpression(
        types.identifier(styleObjectImportName),
        types.identifier(`'${className}'`),
        true
      )

      if (Object.keys(style || {}).length > 0) {
        jssStyleMap.push({ [className]: generateStylesFromStyleObj(style, tokensUsed, propsUsed) })
        classNamesToAppend.add(nodeStyleIdentifier)
      }

      if (referencedStyles && Object.keys(referencedStyles || {}).length > 0) {
        Object.values(referencedStyles).forEach((styleRef) => {
          switch (styleRef.content.mapType) {
            case 'inlined': {
              const { conditions } = styleRef.content
              const [condition] = conditions

              if (Object.keys(styleRef.content.styles || {}).length === 0) {
                return
              }

              if (condition.conditionType === 'screen-size') {
                if (!mediaStyles[String(condition.maxWidth)]) {
                  mediaStyles[String(condition.maxWidth)] = []
                }

                mediaStyles[String(condition.maxWidth)].push({
                  [className]: generateStylesFromStyleObj(
                    styleRef.content.styles,
                    tokensUsed,
                    propsUsed
                  ),
                })
              }

              if (condition.conditionType === 'element-state') {
                const { content } = condition
                jssStyleMap.find((item) => {
                  if (item.hasOwnProperty(className)) {
                    Object.assign(item[className], {
                      [`&:${content}`]: generateStylesFromStyleObj(
                        (styleRef as UIDLElementNodeInlineReferencedStyle).content.styles,
                        tokensUsed,
                        propsUsed
                      ),
                    })
                  }
                })
              }

              classNamesToAppend.add(nodeStyleIdentifier)
              return
            }

            case 'component-referenced': {
              const classContent = styleRef.content.content
              if (classContent.type === 'static') {
                classNamesToAppend.add(types.stringLiteral(String(classContent.content)))
                return
              }

              if (
                classContent.type === 'dynamic' &&
                classContent.content.referenceType === 'prop'
              ) {
                classNamesToAppend.add(
                  types.memberExpression(
                    types.identifier(styleObjectImportName),
                    types.memberExpression(
                      types.identifier(propsPrefix),
                      types.identifier(classContent.content.id)
                    ),
                    true
                  )
                )

                const defaultPropValue = propDefinitions[classContent.content.id]?.defaultValue
                if (!defaultPropValue) {
                  return
                }
                /*
                  Changing the default value of the prop.
                  When forceScoping is enabled the classnames change. So, we need to change the default prop too.
                */
                propDefinitions[classContent.content.id].defaultValue = getClassName(
                  String(defaultPropValue)
                )
              }

              if (
                classContent.type === 'dynamic' &&
                classContent.content.referenceType === 'comp'
              ) {
                classNamesToAppend.add(
                  types.memberExpression(
                    types.identifier(styleObjectImportName),
                    types.identifier(`'${getClassName(classContent.content.id)}'`),
                    true
                  )
                )
              }

              return
            }

            case 'project-referenced': {
              if (!projectStyleSet) {
                throw new PluginReactJSS(
                  `Project Style Sheet is missing, but the node is referring to it ${JSON.stringify(
                    element,
                    null,
                    2
                  )}`
                )
              }

              const { content } = styleRef
              const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
              if (!referedStyle) {
                throw new PluginReactJSS(
                  `Style used from global stylesheet is missing - ${content.referenceId}`
                )
              }

              classNamesToAppend.add(
                types.memberExpression(
                  types.identifier('projectStyles'),
                  types.identifier(`'${getClassName(content.referenceId)}'`),
                  true
                )
              )
              isProjectReferenced = true
              return
            }
            default: {
              throw new PluginReactJSS(`
                Un-supported stlyle reference received ${JSON.stringify(styleRef.content, null, 2)}
              `)
            }
          }
        })
      }

      ASTUtils.addMultipleDynamicAttributesToJSXTag(
        jsxTag,
        classAttributeName,
        Array.from(classNamesToAppend)
      )
    })

    generateProjectStyleSheet({
      styleSetDefinitions: componentStyleSheet,
      jssStyleMap,
      mediaStyles,
      tokensUsed,
    })

    const { content: astContent } = componentChunk
    const parser = new ParsedASTNode(astContent)

    const astNode = (parser.ast as types.VariableDeclaration)
      .declarations[0] as types.VariableDeclarator
    if (astNode.type === 'VariableDeclarator') {
      const isPropsInjected = (astNode.init as types.ArrowFunctionExpression).params?.some(
        (prop: types.Identifier) => prop.name === propsPrefix
      )
      if (!isPropsInjected && propsUsed.length > 0) {
        ;(astNode.init as types.ArrowFunctionExpression).params.push(types.identifier(propsPrefix))
      }
    }

    if (tokensUsed.length > 0) {
      dependencies.TOKENS = {
        type: 'local',
        path: `${projectStyleSet.path}${projectStyleSet.fileName}`,
        meta: {
          namedImport: true,
        },
      }
    }

    if (isProjectReferenced) {
      dependencies.useProjectStyles = {
        type: 'local',
        path: `${projectStyleSet.path}${projectStyleSet.fileName}`,
        meta: {
          namedImport: true,
        },
      }
      ;((astNode.init as types.ArrowFunctionExpression).body as types.BlockStatement).body.unshift(
        createStylesHookDecleration('projectStyles', 'useProjectStyles')
      )
    }

    if (jssStyleMap.length === 0 && Object.keys(mediaStyles).length === 0) {
      return structure
    }

    ;((astNode.init as types.ArrowFunctionExpression).body as types.BlockStatement).body.unshift(
      propsUsed.length > 0
        ? createStylesHookDecleration(styleObjectImportName, 'useStyles', propsPrefix)
        : createStylesHookDecleration(styleObjectImportName, 'useStyles')
    )

    dependencies[EXPORT_IDENTIFIER] = {
      type: 'package',
      path: 'react-jss',
      version: '10.4.0',
      meta: {
        namedImport: true,
      },
    }

    chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: styleChunkName,
      linkAfter: [importChunkName],
      content: ASTBuilders.createConstAssignment(
        jssDeclarationName,
        types.callExpression(types.identifier(EXPORT_IDENTIFIER), [
          convertMediaAndStylesToObject(jssStyleMap, mediaStyles),
        ])
      ),
    })

    return structure
  }

  return reactJSSPlugin
}

export { createStyleSheetPlugin }

export default createReactJSSPlugin()

const getClassName = (str: string) => StringUtils.dashCaseToCamelCase(str)
