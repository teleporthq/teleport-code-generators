import {
  traverseElements,
  getComponentFileName,
  getComponentPath,
  extractRoutes,
  extractPageMetadata,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import {
  GeneratedFile,
  GeneratedFolder,
  UIDLElement,
  ComponentUIDL,
  UIDLConditionalNode,
  UIDLStateDefinition,
  ProjectStrategy,
} from '@teleporthq/teleport-types'
import { elementNode } from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

export const createPageUIDLs = (
  root: ComponentUIDL,
  strategy: ProjectStrategy
): ComponentUIDL[] => {
  const routeNodes = extractRoutes(root)
  return routeNodes.map((routeNode) =>
    createPageUIDL(routeNode, root.stateDefinitions.route, strategy)
  )
}

const createPageUIDL = (
  routeNode: UIDLConditionalNode,
  routeDefintion: UIDLStateDefinition,
  strategy: ProjectStrategy
): ComponentUIDL => {
  const { value, node } = routeNode.content
  const pageName = value.toString()
  const pagesStrategyOptions = strategy.pages.options || {}

  const { componentName, fileName } = extractPageMetadata(
    routeDefintion,
    pageName,
    strategy.pages.options
  )

  // If the file name will not be used as the path (eg: next, nuxt)
  // And if the option to create each page in its folder is passed (eg: preact)
  const createPathInOwnFile =
    !pagesStrategyOptions.usePathAsFileName && pagesStrategyOptions.createFolderForEachComponent

  const meta = createPathInOwnFile
    ? {
        fileName: pagesStrategyOptions.customComponentFileName || 'index',
        styleFileName: pagesStrategyOptions.customStyleFileName || 'style',
        templateFileName: pagesStrategyOptions.customTemplateFileName || 'template',
        path: [fileName],
      }
    : {
        fileName,
        styleFileName: fileName,
        templateFileName: fileName,
        path: [],
      }

  // Because conditional nodes accept any type of UIDLNode as a child
  // we need to ensure that the page is always of type 'element'
  // The solution is to wrap a non-element node with a 'group' element
  const pageContent = node.type === 'element' ? node : elementNode('group', {}, [node])

  return {
    name: componentName,
    node: pageContent,
    meta,
  }
}

export const prepareComponentFilenamesAndPath = (
  components: Record<string, ComponentUIDL>,
  strategy: ProjectStrategy
) => {
  const componentStrategyOptions = strategy.components.options || {}

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const fileName = getComponentFileName(component)
    const path = getComponentPath(component)

    // If the component has its own folder, name is 'index' or an override from the strategy.
    // In this case, the file name (dash converted) is used as the folder name
    if (componentStrategyOptions.createFolderForEachComponent) {
      component.meta = {
        fileName: componentStrategyOptions.customComponentFileName || 'index',
        styleFileName: componentStrategyOptions.customStyleFileName || 'style',
        templateFileName: componentStrategyOptions.customTemplateFileName || 'template',
        path: [...path, fileName],
      }
    } else {
      component.meta = {
        fileName,
        styleFileName: fileName,
        templateFileName: fileName,
        path,
      }
    }
  })
}

export const resolveLocalDependencies = (
  pageUIDLs: ComponentUIDL[],
  components: Record<string, ComponentUIDL>,
  strategy: ProjectStrategy
) => {
  pageUIDLs.forEach((pageUIDL) => {
    const pagePath = getComponentPath(pageUIDL)
    const fromPath = strategy.pages.path.concat(pagePath)
    traverseElements(pageUIDL.node, (element) => {
      if (isLocalDependency(element)) {
        setLocalDependencyPath(element, components, fromPath, strategy.components.path)
      }
    })
  })

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const componentPath = getComponentPath(component)
    const fromPath = strategy.components.path.concat(componentPath)

    traverseElements(component.node, (element) => {
      if (isLocalDependency(element)) {
        setLocalDependencyPath(element, components, fromPath, strategy.components.path)
      }
    })
  })
}

const isLocalDependency = (element: UIDLElement) =>
  element.dependency && element.dependency.type === 'local'

const setLocalDependencyPath = (
  element: UIDLElement,
  components: Record<string, ComponentUIDL>,
  fromPath: string[],
  toBasePath: string[]
) => {
  const componentKey = element.elementType
  const component = components[componentKey]
  const componentPath = getComponentPath(component)

  const toPath = toBasePath.concat(componentPath)

  const importFileName = getComponentFileName(component)
  const importPath = generateLocalDependenciesPrefix(fromPath, toPath)
  element.dependency.path = `${importPath}${importFileName}`
}

export const generateLocalDependenciesPrefix = (fromPath: string[], toPath: string[]): string => {
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
  const pathsClone = JSON.parse(JSON.stringify(paths))

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

export const injectFilesToPath = (
  rootFolder: GeneratedFolder,
  path: string[],
  files: GeneratedFile[]
): void => {
  let folder = findFolderByPath(rootFolder, path)

  if (!folder) {
    folder = createFolderInPath(rootFolder, path)
  }

  files.forEach((fileToInject) => {
    const existingFile = findFileInFolder(fileToInject, folder)
    if (existingFile) {
      existingFile.content = fileToInject.content
      existingFile.contentEncoding = fileToInject.contentEncoding
    } else {
      folder.files.push(fileToInject)
    }
  })
}

const createFolderInPath = (rootFolder: GeneratedFolder, folderPath: string[]): GeneratedFolder => {
  let currentFolder = rootFolder
  let createdFolder: GeneratedFolder

  folderPath.forEach((path, index) => {
    let intermediateFolder = findSubFolderByName(currentFolder, path)

    if (!intermediateFolder) {
      intermediateFolder = { name: path, files: [], subFolders: [] }
      currentFolder.subFolders.push(intermediateFolder)
    }
    currentFolder = intermediateFolder

    if (index === folderPath.length - 1) {
      createdFolder = currentFolder
    }
  })

  return createdFolder
}

const findFolderByPath = (rootFolder: GeneratedFolder, folderPath: string[]): GeneratedFolder => {
  if (!folderPath || !folderPath.length) {
    return rootFolder
  }

  const folderPathClone = JSON.parse(JSON.stringify(folderPath))
  const path = folderPathClone.shift()

  const subFolder = findSubFolderByName(rootFolder, path)
  return subFolder ? findFolderByPath(subFolder, folderPathClone) : null
}

const findSubFolderByName = (rootFolder: GeneratedFolder, folderName: string): GeneratedFolder => {
  return rootFolder.subFolders.find((folder) => {
    return folder.name === folderName
  })
}

const findFileInFolder = (file: GeneratedFile, folder: GeneratedFolder) => {
  return folder.files.find((f) => f.name === file.name && f.fileType === file.fileType)
}
