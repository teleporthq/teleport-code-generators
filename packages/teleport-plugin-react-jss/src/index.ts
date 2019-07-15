import { addDynamicAttributeToJSXTag } from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import {
  ParsedASTNode,
  objectToObjectExpression,
} from '@teleporthq/teleport-shared/lib/utils/ast-js-utils'

import {
  createConstAssignment,
  createReactJSSDefaultExport,
  createArrowFunctionWithMemberExpression,
} from '@teleporthq/teleport-shared/lib/builders/ast-builders'

import { camelCaseToDashCase } from '@teleporthq/teleport-shared/lib/utils/string-utils'
import {
  traverseElements,
  transformDynamicStyles,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

interface JSSConfig {
  styleChunkName?: string
  importChunkName?: string
  componentChunkName: string
  exportChunkName: string
  jssDeclarationName?: string
}
export const createPlugin: ComponentPluginFactory<JSSConfig> = (config) => {
  const {
    componentChunkName = 'react-component',
    importChunkName = 'import-local',
    styleChunkName = 'jss-style-definition',
    exportChunkName = 'export',
    jssDeclarationName = 'style',
  } = config || {}

  const reactJSSComponentStyleChunksPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const jssStyleMap = {}

    traverseElements(node, (element) => {
      const { style, key } = element
      if (style && Object.keys(style).length > 0) {
        const root = jsxNodesLookup[key]
        const className = camelCaseToDashCase(key)
        jssStyleMap[className] = transformDynamicStyles(style, (styleValue) => {
          if (styleValue.content.referenceType === 'prop') {
            return new ParsedASTNode(
              createArrowFunctionWithMemberExpression('props', styleValue.content.id)
            )
          }
          throw new Error(
            `Error running transformDynamicStyles in reactJSSComponentStyleChunksPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
          )
        })
        addDynamicAttributeToJSXTag(root, 'className', `classes['${className}']`, 'props')
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
      type: 'js',
      name: styleChunkName,
      linkAfter: [importChunkName],
      content: createConstAssignment(jssDeclarationName, objectToObjectExpression(jssStyleMap)),
    })

    const exportChunk = chunks.find((chunk) => chunk.name === exportChunkName)

    const exportStatement = createReactJSSDefaultExport(uidl.name, jssDeclarationName)

    if (exportChunk) {
      exportChunk.content = exportStatement
      exportChunk.linkAfter = [importChunkName, styleChunkName]
    } else {
      chunks.push({
        type: 'js',
        name: exportChunkName,
        content: exportStatement,
        linkAfter: [importChunkName, styleChunkName],
      })
    }

    return structure
  }

  return reactJSSComponentStyleChunksPlugin
}

export default createPlugin()
