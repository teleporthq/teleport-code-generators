import {
  cloneObject,
  traverseElements,
  getComponentFileName,
  getComponentPath,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import {
  GeneratedFile,
  GeneratedFolder,
  ProjectUIDL,
  UIDLElement,
  ComponentUIDL,
} from '@teleporthq/teleport-types'

import { ProjectStrategy } from './types'

export const resolveLocalDependencies = (input: ProjectUIDL, strategy: ProjectStrategy) => {
  const result = cloneObject(input)

  const { components, root } = result

  traverseElements(root.node, (elementNode) => {
    if (emptyLocalDependency(elementNode)) {
      setLocalDependencyPath(elementNode, components, strategy.pages.path, strategy.components.path)
    }
  })

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const componentPath = getComponentPath(component)
    const fromPath = strategy.components.path.concat(componentPath)

    traverseElements(component.node, (elementNode) => {
      if (emptyLocalDependency(elementNode)) {
        setLocalDependencyPath(elementNode, components, fromPath, strategy.components.path)
      }
    })
  })

  return result
}

const emptyLocalDependency = (elementNode: UIDLElement) =>
  elementNode.dependency && elementNode.dependency.type === 'local' && !elementNode.dependency.path

const setLocalDependencyPath = (
  elementNode: UIDLElement,
  components: Record<string, ComponentUIDL>,
  fromPath: string[],
  toBasePath: string[]
) => {
  const componentKey = elementNode.elementType
  const component = components[componentKey]
  const componentPath = getComponentPath(component)

  const toPath = toBasePath.concat(componentPath)

  const importFileName = getComponentFileName(component)
  const importPath = generateLocalDependenciesPrefix(fromPath, toPath)
  elementNode.dependency.path = `${importPath}${importFileName}`
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
