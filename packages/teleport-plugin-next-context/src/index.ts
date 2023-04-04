import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLElement,
  UIDLNode,
} from '@teleporthq/teleport-types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
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

    const compPath = outputOptions.folderPath || []

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

      if (elementType === 'context') {
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
        const pathToFile = generateLocalDependenciesPrefix(['', ...compPath], ['contexts'])
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

// THE FOLLOWING FUNCTIONS ARE COPIED FROM THE TELEPORT PROJECT GENERATOR
const generateLocalDependenciesPrefix = (fromPath: string[], toPath: string[]): string => {
  /*
    Remove common path elements from the beginning of the
    components and pages full path (if any)
  
    For example, having:
    - fromPath = ['src', 'components']
    - toPath = ['src', 'pages']
  
    If we want to have an import statement that goes from the pages folder to the
    components folder, we only need to go back one step, so we are removing
    the first element from both the paths ('src') and build the dependencyPrefix accordingly
  */
  const [firstPath, secondPath] = removeCommonStartingPointsFromPaths([fromPath, toPath])

  // We have to go back as many folders as there are defined in the pages path
  let dependencyPrefix = '../'.repeat(firstPath.length)

  // if 'fromPath' is parent for 'toPath', the path starts from './'
  if (firstPath.length === 0) {
    secondPath.unshift('.')
  }

  dependencyPrefix += secondPath
    .map((folder) => {
      return `${folder}/`
    })
    .join('')

  return dependencyPrefix
}

const removeCommonStartingPointsFromPaths = (paths: string[][]): string[][] => {
  const pathsClone: string[][] = JSON.parse(JSON.stringify(paths))

  const shortestPathLength = Math.min(
    ...pathsClone.map((path) => {
      return path.length
    })
  )

  let elementIndex = 0
  let elementsFromIndexAreEqual = true

  while (elementIndex < shortestPathLength && elementsFromIndexAreEqual) {
    const firstPathElementsFromIndex = pathsClone.map((path: string[]) => {
      return path[0]
    })

    if (elementsFromArrayAreEqual(firstPathElementsFromIndex)) {
      // If the first elements from every path are equal, remove it
      pathsClone.forEach((path) => {
        path.shift()
      })
    } else {
      elementsFromIndexAreEqual = false
    }
    elementIndex += 1
  }

  return pathsClone
}

const elementsFromArrayAreEqual = (arrayOfElements: string[]): boolean => {
  return arrayOfElements.every((element: string) => {
    return element === arrayOfElements[0]
  })
}
