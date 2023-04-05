import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLElement,
  UIDLNode,
} from '@teleporthq/teleport-types'
import { GenericUtils, StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'

interface ContextPluginConfig {
  componentChunkName?: string
}

export const createNextContextPlugin: ComponentPluginFactory<ContextPluginConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const nextContextPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { projectContexts = {} } = options
    const { outputOptions } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const compPath = (outputOptions.folderPath || []).filter((el) => el)

    const usedContexts = UIDLUtils.extractContextDependenciesFromNode(uidl.node, projectContexts)
    Object.keys(usedContexts).forEach((contextKey) => {
      const { fileName, consumerName, providerName } = projectContexts[contextKey]

      dependencies[consumerName] = {
        type: 'local',
        path: `../contexts/${fileName}`,
        meta: {
          namedImport: true,
        },
      }

      const contextAst = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier(StringUtils.camelize(providerName)),
          types.callExpression(types.identifier(consumerName), [])
        ),
      ])

      try {
        // @ts-ignore
        componentChunk.content.declarations[0].init.body.body.unshift(contextAst)
      } catch (error) {
        return
      }
    })

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      const { content } = node as UIDLNode
      const { elementType, key, ctxId } = content as UIDLElement

      if (elementType === 'cms-list' || elementType === 'cms-item') {
        const nodeElement = (
          componentChunk.meta.nodesLookup as unknown as Record<string, types.JSXElement>
        )[key]

        const contextToTake = projectContexts[ctxId]

        nodeElement.openingElement.name = types.jsxIdentifier(
          `${contextToTake.providerName}.Provider`
        )
        nodeElement.closingElement.name = types.jsxIdentifier(
          `${contextToTake.providerName}.Provider`
        )

        const { fileName, providerName } = projectContexts[ctxId]
        const pathToFile = GenericUtils.generateLocalDependenciesPrefix(
          ['', ...compPath],
          ['contexts']
        )
        dependencies[providerName] = {
          type: 'local',
          path: `${pathToFile}${fileName}`,
          meta: {
            namedImport: true,
          },
        }
      }
    })

    return structure
  }

  return nextContextPlugin
}

export default createNextContextPlugin()
