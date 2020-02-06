import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'

import { ASTUtils, ASTBuilders, ParsedASTNode } from '@teleporthq/teleport-plugin-common'

import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

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
    const { uidl, chunks, dependencies } = structure

    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    // @ts-ignore
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const jssStyleMap: Record<string, unknown> = {}

    UIDLUtils.traverseElements(node, (element) => {
      const { style, key } = element
      if (style && Object.keys(style).length > 0) {
        // @ts-ignore
        const root = jsxNodesLookup[key]
        const className = StringUtils.camelCaseToDashCase(key)
        jssStyleMap[className] = UIDLUtils.transformDynamicStyles(style, (styleValue) => {
          if (styleValue.content.referenceType === 'prop') {
            return new ParsedASTNode(
              ASTBuilders.createArrowFunctionWithMemberExpression('props', styleValue.content.id)
            )
          }
          throw new Error(
            `Error running transformDynamicStyles in reactJSSComponentStyleChunksPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
          )
        })
        ASTUtils.addDynamicAttributeToJSXTag(
          root,
          classAttributeName,
          `classes['${className}']`,
          propsPrefix
        )
      }
    })

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

export default createReactJSSPlugin()
