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
  exportChunkName: string
  jssDeclarationName?: string
  classAttributeName?: string
}
export const createReactJSSPlugin: ComponentPluginFactory<JSSConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    importChunkName = 'import-local',
    styleChunkName = 'jss-style-definition',
    exportChunkName = 'export',
    jssDeclarationName = 'style',
    classAttributeName = 'className',
  } = config || {}

  const reactJSSPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { projectStyleSet } = options
    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    // @ts-ignore
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const jssStyleMap: Record<string, unknown> = {}
    let isProjectReferenced: boolean = false

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
      if (style && Object.keys(style).length > 0) {
        jssStyleMap[className] = generatePropSyntax(style)
        appendClassname = true
      }

      if (referencedStyles && Object.keys(referencedStyles)?.length > 0) {
        Object.values(referencedStyles).forEach((styleRef) => {
          switch (styleRef.content?.mapType) {
            case 'inlined': {
              const { conditions } = styleRef.content
              const [condition] = conditions
              if (condition.conditionType === 'screen-size') {
                jssStyleMap[className] = {
                  ...(jssStyleMap[className] as Record<string, string>),
                  [`@media(max-width: ${condition.maxWidth}px)`]: generatePropSyntax(
                    styleRef.content.styles
                  ),
                }
              }

              if (condition.conditionType === 'element-state') {
                jssStyleMap[className] = {
                  ...(jssStyleMap[className] as Record<string, string>),
                  [`&:${condition.content}`]: generatePropSyntax(styleRef.content.styles),
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
                if (!referencedStyles) {
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
        classNamesToAppend.push(`${propsPrefix}.classes['${className}']`)
      }

      if (classNamesToAppend.length > 1) {
        ASTUtils.addMultipleDynamicAttributesToJSXTag(root, classAttributeName, classNamesToAppend)
      } else if (classNamesToAppend.length === 1) {
        ASTUtils.addDynamicAttributeToJSXTag(root, classAttributeName, classNamesToAppend[0])
      }
    })

    if (isProjectReferenced) {
      // Adding dependency from the exported sheet
      dependencies.useProjectStyles = {
        type: 'local',
        path: `${projectStyleSet.path}/${projectStyleSet.fileName}`,
        meta: {
          namedImport: true,
        },
      }

      const chunk = chunks.find((item) => item.name === 'jsx-component')
      if (!chunk) {
        throw new Error(`jsx-component chunk is missing, cannot inset useProjectStyles() hook`)
      }
      const { content } = chunk
      const parser = new ParsedASTNode(content)
      // @ts-ignore
      const astNode = parser.ast.declarations[0]
      astNode.init.body.body.unshift(createStylesHookDecleration())
    }

    if (!Object.keys(jssStyleMap).length) {
      // if no styles are defined, no need to build the jss style at all
      return structure
    }

    dependencies.injectSheet = {
      type: 'library',
      path: 'react-jss',
      version: '8.6.1',
    }

    chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: styleChunkName,
      linkAfter: [importChunkName],
      content: ASTBuilders.createConstAssignment(
        jssDeclarationName,
        ASTUtils.objectToObjectExpression(jssStyleMap)
      ),
    })

    const exportChunk = chunks.find((chunk) => chunk.name === exportChunkName)

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const exportStatement = ASTBuilders.createReactJSSDefaultExport(
      componentName,
      jssDeclarationName
    )

    if (exportChunk) {
      exportChunk.content = exportStatement
      exportChunk.linkAfter = [importChunkName, styleChunkName]
    } else {
      chunks.push({
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: exportChunkName,
        content: exportStatement,
        linkAfter: [importChunkName, styleChunkName],
      })
    }

    return structure
  }

  return reactJSSPlugin
}

export { createStyleSheetPlugin }

export default createReactJSSPlugin()
