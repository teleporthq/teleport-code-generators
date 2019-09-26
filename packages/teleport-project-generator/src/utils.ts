import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'

import {
  GeneratedFile,
  GeneratedFolder,
  UIDLElement,
  ComponentUIDL,
  ProjectUIDL,
  UIDLConditionalNode,
  ProjectStrategy,
  UIDLStateDefinition,
  UIDLPageOptions,
} from '@teleporthq/teleport-types'
import { elementNode } from '@teleporthq/teleport-uidl-builders'

export const createPageUIDLs = (uidl: ProjectUIDL, strategy: ProjectStrategy): ComponentUIDL[] => {
  const routeNodes = UIDLUtils.extractRoutes(uidl.root)
  return routeNodes.map((routeNode) => createPageUIDL(routeNode, uidl, strategy))
}

const createPageUIDL = (
  routeNode: UIDLConditionalNode,
  uidl: ProjectUIDL,
  strategy: ProjectStrategy
): ComponentUIDL => {
  const { value, node } = routeNode.content
  const pageName = value.toString()
  const routeDefinition = uidl.root.stateDefinitions.route
  const pagesStrategyOptions = strategy.pages.options || {}

  const pageOptions = extractPageOptions(
    routeDefinition,
    pageName,
    pagesStrategyOptions.useFileNameForNavigation
  )

  // Update pageOptions based on the values computed at the previous step
  const pageDefinition = routeDefinition.values.find((route) => route.value === pageName)
  pageDefinition.pageOptions = pageOptions

  const { fileName, componentName } = pageOptions

  // If the file name will not be used as the path (eg: next, nuxt)
  // And if the option to create each page in its folder is passed (eg: preact)
  const createFolderForEachComponent =
    !pagesStrategyOptions.useFileNameForNavigation &&
    pagesStrategyOptions.createFolderForEachComponent

  const {
    customComponentFileName,
    customStyleFileName,
    customTemplateFileName,
  } = pagesStrategyOptions

  const outputOptions = createFolderForEachComponent
    ? {
        componentName,
        fileName: (customComponentFileName && customComponentFileName(fileName)) || 'index',
        styleFileName: (customStyleFileName && customStyleFileName(fileName)) || 'style',
        templateFileName:
          (customTemplateFileName && customTemplateFileName(fileName)) || 'template',
        folderPath: [fileName],
      }
    : {
        componentName,
        fileName,
        styleFileName: fileName,
        templateFileName: fileName,
        folderPath: [],
      }

  // Looking into the state definition, we take the seo information for the corresponding page
  // If no title is provided for the page, the global settings title is passed as a default
  const title = (pageDefinition.seo && pageDefinition.seo.title) || uidl.globals.settings.title
  const seo = {
    ...pageDefinition.seo,
    title,
  }

  // Because conditional nodes accept any type of UIDLNode as a child
  // we need to ensure that the page is always of type 'element'
  // The solution is to wrap a non-element node with a 'group' element
  const pageContent = node.type === 'element' ? node : elementNode('group', {}, [node])

  return {
    name: componentName,
    node: pageContent,
    outputOptions,
    seo,
  }
}

/**
 * A couple of different cases which need to be handled
 * In case of next/nuxt generators, the file names represent the urls of the pages
 * Also the root path needs to be represented by the index file
 */
export const extractPageOptions = (
  routeDefinitions: UIDLStateDefinition,
  routeName: string,
  useFileNameForNavigation = false
): UIDLPageOptions => {
  const isHomePage = routeDefinitions.defaultValue === routeName
  const pageDefinitions = routeDefinitions.values || []
  const pageDefinition = pageDefinitions.find((stateDef) => stateDef.value === routeName)

  // If no meta object is defined, the stateName is used
  const friendlyStateName = StringUtils.removeIllegalCharacters(routeName) // remove space, leading numbers, etc.
  const friendlyComponentName = StringUtils.dashCaseToUpperCamelCase(friendlyStateName) // component name in UpperCamelCase
  const friendlyFileName = StringUtils.camelCaseToDashCase(friendlyStateName) // file name in dash-case

  let pageOptions: UIDLPageOptions = {
    // default values extracted from state name
    fileName: friendlyFileName,
    componentName: friendlyComponentName,
    navLink: '/' + (isHomePage ? '' : friendlyFileName),
  }

  if (pageDefinition && pageDefinition.pageOptions) {
    // The pageDefinition values have precedence, defaults are fallbacks
    pageOptions = {
      ...pageOptions,
      ...pageDefinition.pageOptions,
    }
  }

  // In case of next/nuxt, the path dictates the file name, so this is adjusted accordingly
  // Also, the defaultPage has to be index, overriding any other value set
  if (useFileNameForNavigation) {
    const fileName = pageOptions.navLink.replace('/', '')
    pageOptions.fileName = isHomePage ? 'index' : fileName
  }

  const otherPages = pageDefinitions.filter((page) => page.value !== routeName && page.pageOptions)
  deduplicatePageOptionValues(pageOptions, otherPages.map((page) => page.pageOptions))

  return pageOptions
}

const deduplicatePageOptionValues = (
  pageOptions: UIDLPageOptions,
  otherPagesOptions: UIDLPageOptions[]
) => {
  if (otherPagesOptions.some((opt) => opt.navLink === pageOptions.navLink)) {
    console.warn(
      `Potential duplication solved by appending a '1' to the navlink: ${pageOptions.navLink}`
    )
    pageOptions.navLink += '1'
  }

  if (otherPagesOptions.some((opt) => opt.componentName === pageOptions.componentName)) {
    console.warn(
      `Potential duplication solved by appending a '1' to the componentName: ${pageOptions.componentName}`
    )
    pageOptions.componentName += '1'
  }

  if (otherPagesOptions.some((opt) => opt.fileName === pageOptions.fileName)) {
    console.warn(
      `Potential duplication solved by appending a '1' to the fileName: ${pageOptions.fileName}`
    )
    pageOptions.fileName += '1'
  }
}

export const prepareComponentOutputOptions = (
  components: Record<string, ComponentUIDL>,
  strategy: ProjectStrategy
) => {
  const componentStrategyOptions = strategy.components.options || {}

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const fileName = UIDLUtils.getComponentFileName(component)
    const folderPath = UIDLUtils.getComponentFolderPath(component)

    // If the component has its own folder, name is 'index' or an override from the strategy.
    // In this case, the file name (dash converted) is used as the folder name
    if (componentStrategyOptions.createFolderForEachComponent) {
      const {
        customComponentFileName,
        customStyleFileName,
        customTemplateFileName,
      } = componentStrategyOptions

      component.outputOptions = {
        fileName: (customComponentFileName && customComponentFileName(fileName)) || 'index',
        styleFileName: (customStyleFileName && customStyleFileName(fileName)) || 'style',
        templateFileName:
          (customTemplateFileName && customTemplateFileName(fileName)) || 'template',
        folderPath: [...folderPath, fileName],
      }
    } else {
      component.outputOptions = {
        fileName,
        styleFileName: fileName,
        templateFileName: fileName,
        folderPath,
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
    const pagePath = UIDLUtils.getComponentFolderPath(pageUIDL)
    const fromPath = strategy.pages.path.concat(pagePath)
    UIDLUtils.traverseElements(pageUIDL.node, (element) => {
      if (isLocalDependency(element)) {
        setLocalDependencyPath(element, components, fromPath, strategy.components.path)
      }
    })
  })

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const componentPath = UIDLUtils.getComponentFolderPath(component)
    const fromPath = strategy.components.path.concat(componentPath)

    UIDLUtils.traverseElements(component.node, (element) => {
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
  const componentPath = UIDLUtils.getComponentFolderPath(component)

  const toPath = toBasePath.concat(componentPath)

  const importFileName = UIDLUtils.getComponentFileName(component)
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
