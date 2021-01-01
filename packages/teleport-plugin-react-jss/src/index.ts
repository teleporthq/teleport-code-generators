import * as types from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, ASTBuilders, ParsedASTNode } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generatePropSyntax, createStylesHookDecleration } from './utils'
import { createStyleSheetPlugin } from './style-sheet'

interface JSSConfig {
  styleChunkName?: string
  importChunkName?: string
  componentChunkName: string
  jssDeclarationName?: string
  classAttributeName?: string
}
const EXPORT_IDENTIFIER = 'createUseStyles'

export const createReactJSSPlugin: ComponentPluginFactory<JSSConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    importChunkName = 'import-local',
    styleChunkName = 'jss-style-definition',
    jssDeclarationName = 'useStyles',
    classAttributeName = 'className',
  } = config || {}

  const reactJSSPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { projectStyleSet } = options
    const { node } = uidl

    const componentChunk = chunks.find((chunkItem) => chunkItem.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const jssStyleMap: Record<string, unknown> = {}
    let isProjectReferenced: boolean = false
    let isTokenReferenced = false
    let isPropsReferenced = false

    UIDLUtils.traverseElements(node, (element) => {
      const { style, key, referencedStyles } = element
      let appendClassname: boolean = false
      if (!style && !referencedStyles) {
        return
      }
      // @ts-ignore
      const root = jsxNodesLookup[key]
      const className = StringUtils.camelCaseToDashCase(key)
      const classNamesToAppend: string[] = []

      if (Object.keys(style || {}).length > 0) {
        const { transformedStyles, tokensUsed, propsUsed } = generatePropSyntax(style)
        jssStyleMap[className] = transformedStyles
        if (tokensUsed) {
          isTokenReferenced = true
        }
        if (propsUsed) {
          isPropsReferenced = true
        }
        appendClassname = true
      }

      if (referencedStyles && Object.keys(referencedStyles)?.length > 0) {
        Object.values(referencedStyles).forEach((styleRef) => {
          switch (styleRef.content?.mapType) {
            case 'inlined': {
              const { conditions } = styleRef.content
              const [condition] = conditions

              if (Object.keys(styleRef.content.styles || {}).length === 0) {
                return
              }

              if (condition.conditionType === 'screen-size') {
                const { transformedStyles, tokensUsed, propsUsed } = generatePropSyntax(
                  styleRef.content.styles
                )
                if (tokensUsed) {
                  isTokenReferenced = true
                }
                if (propsUsed) {
                  isPropsReferenced = true
                }
                jssStyleMap[className] = {
                  ...(jssStyleMap[className] as Record<string, string>),

                  [`@media(max-width: ${condition.maxWidth}px)`]: transformedStyles,
                }
              }

              if (condition.conditionType === 'element-state') {
                const { transformedStyles, tokensUsed, propsUsed } = generatePropSyntax(
                  styleRef.content.styles
                )
                if (tokensUsed) {
                  isTokenReferenced = true
                }
                if (propsUsed) {
                  isPropsReferenced = true
                }
                jssStyleMap[className] = {
                  ...(jssStyleMap[className] as Record<string, string>),
                  [`&:${condition.content}`]: transformedStyles,
                }
              }

              appendClassname = true
              return
            }
            case 'project-referenced': {
              if (!projectStyleSet) {
                throw new Error(
                  `Project Style Sheet is missing, but the node is referring to it ${element}`
                )
              }

              const { content } = styleRef
              if (content.referenceId && !content?.conditions) {
                const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
                if (!referedStyle) {
                  throw new Error(
                    `Style that is being used for reference is missing - ${content.referenceId}`
                  )
                }
                classNamesToAppend.push(
                  `projectStyles['${StringUtils.dashCaseToCamelCase(referedStyle.name)}']`
                )
              }
              isProjectReferenced = true
              return
            }
            default: {
              throw new Error(`
                We support only inlined and project-referenced styles as of now, received ${styleRef.content}
              `)
            }
          }
        })
      }

      if (appendClassname) {
        classNamesToAppend.push(`classes['${className}']`)
      }

      if (classNamesToAppend.length > 1) {
        ASTUtils.addMultipleDynamicAttributesToJSXTag(root, classAttributeName, classNamesToAppend)
      } else if (classNamesToAppend.length === 1) {
        ASTUtils.addDynamicAttributeToJSXTag(root, classAttributeName, classNamesToAppend[0])
      }
    })

    const { content: astContent } = componentChunk
    const parser = new ParsedASTNode(astContent)
    // @ts-ignore
    const astNode = parser.ast.declarations[0]
    const isPropsInjected = astNode.init.params?.some(
      (prop: types.Identifier) => prop.name === 'props'
    )
    if (!isPropsInjected && isPropsReferenced) {
      astNode.init.params.push(types.identifier('props'))
    }

    if (isTokenReferenced) {
      dependencies.TOKENS = {
        type: 'local',
        path: `${projectStyleSet.path}/${projectStyleSet.fileName}`,
        meta: {
          namedImport: true,
        },
      }
    }

    if (isProjectReferenced) {
      dependencies.useProjectStyles = {
        type: 'local',
        path: `${projectStyleSet.path}/${projectStyleSet.fileName}`,
        meta: {
          namedImport: true,
        },
      }
      // @ts-ignore
      astNode.init.body.body.unshift(
        createStylesHookDecleration('projectStyles', 'useProjectStyles')
      )
    }

    if (!Object.keys(jssStyleMap).length) {
      return structure
    }

    // @ts-ignore
    astNode.init.body.body.unshift(
      isPropsReferenced
        ? createStylesHookDecleration('classes', 'useStyles', 'props')
        : createStylesHookDecleration('classes', 'useStyles')
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
          ASTUtils.objectToObjectExpression(jssStyleMap),
        ])
      ),
    })

    return structure
  }

  return reactJSSPlugin
}

export { createStyleSheetPlugin }

export default createReactJSSPlugin()
