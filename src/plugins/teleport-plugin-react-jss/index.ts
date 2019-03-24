import * as t from '@babel/types'
import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'

import { addDynamicAttributeOnTag } from '../../shared/utils/ast-jsx-utils'
import {
  ParsedASTNode,
  makeConstAssign,
  objectToObjectExpression,
} from '../../shared/utils/ast-js-utils'
import { makeJSSDefaultExport } from './utils'

import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import { traverseNodes, transformDynamicStyles } from '../../shared/utils/uidl-utils'

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

    const { content } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const jssStyleMap = {}

    traverseNodes(content, (node) => {
      const { style, key } = node
      if (style) {
        const root = jsxNodesLookup[key]
        const className = cammelCaseToDashCase(key)
        jssStyleMap[className] = transformDynamicStyles(
          style,
          (styleValue) =>
            new ParsedASTNode(
              t.arrowFunctionExpression(
                [t.identifier('props')],
                t.memberExpression(
                  t.identifier('props'),
                  t.identifier(styleValue.replace('$props.', ''))
                )
              )
            )
        )
        addDynamicAttributeOnTag(root, 'className', `classes['${className}']`, 'props')
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
      content: makeConstAssign(jssDeclarationName, objectToObjectExpression(jssStyleMap)),
    })

    const exportChunk = chunks.find((chunk) => chunk.name === exportChunkName)

    const exportStatement = makeJSSDefaultExport(uidl.name, jssDeclarationName)

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
