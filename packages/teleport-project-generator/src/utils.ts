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
  UIDLComponentOutputOptions,
  UIDLExternalDependency,
} from '@teleporthq/teleport-types'
import { elementNode } from '@teleporthq/teleport-uidl-builders'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

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

  const { pageOptions, isHomePage } = extractPageOptions(
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

  // a page can be: 'about-us.js' or `about-us/index.js`
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
        fileName: (customComponentFileName && customComponentFileName(fileName)) || fileName,
        styleFileName: (customStyleFileName && customStyleFileName(fileName)) || fileName,
        templateFileName: (customTemplateFileName && customTemplateFileName(fileName)) || fileName,
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

  const componentUIDL: ComponentUIDL = {
    name: componentName,
    node: pageContent,
    outputOptions,
    seo,
  }

  /* Adding all kinds of peer dependencies and importing css only files
   are good to be added in router. So, for projects which don't follow that
   We will use since we don't generate any router */

  /* Fow now frameworks which follow file name for navigation
   have such constaraints like placing all css imports in some other files */
  if (isHomePage && strategy.pages?.options?.useFileNameForNavigation) {
    const { importDefinitions = {} } = uidl.root

    componentUIDL.importDefinitions = Object.keys(importDefinitions).reduce(
      (acc: Record<string, UIDLExternalDependency>, importRef) => {
        if (
          strategy.framework?.externalStyles &&
          importDefinitions[importRef].path.endsWith('.css')
        ) {
          return acc
        }
        acc[importRef] = importDefinitions[importRef]
        return acc
      },
      {}
    )
  }

  return componentUIDL
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
): { pageOptions: UIDLPageOptions; isHomePage: boolean } => {
  const isHomePage = routeDefinitions.defaultValue === routeName
  const pageDefinitions = routeDefinitions.values || []
  const pageDefinition = pageDefinitions.find((stateDef) => stateDef.value === routeName)

  // If no meta object is defined, the stateName is used
  const defaultPageName = 'AppPage'
  const friendlyStateName = StringUtils.removeIllegalCharacters(routeName) || defaultPageName // remove space, leading numbers, etc.
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
  deduplicatePageOptionValues(
    pageOptions,
    otherPages.map((page) => page.pageOptions)
  )

  return { pageOptions, isHomePage }
}

export const prepareComponentOutputOptions = (
  components: Record<string, ComponentUIDL>,
  strategy: ProjectStrategy
) => {
  const componentStrategyOptions = strategy.components.options || {}

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]

    // values coming from the input UIDL
    const { fileName, componentClassName } = component.outputOptions || {
      fileName: '',
      componentClassName: '',
    }

    const defaultComponentName = 'AppComponent'
    const friendlyName = StringUtils.removeIllegalCharacters(component.name) || defaultComponentName
    const friendlyFileName = fileName || StringUtils.camelCaseToDashCase(friendlyName) // ex: primary-button
    const friendlyComponentName =
      componentClassName || StringUtils.dashCaseToUpperCamelCase(friendlyName) // ex: PrimaryButton
    const folderPath = UIDLUtils.getComponentFolderPath(component)

    const {
      customComponentFileName,
      customStyleFileName,
      customTemplateFileName,
    } = componentStrategyOptions

    // If the component has its own folder, name is 'index' or an override from the strategy.
    // In this case, the file name (dash converted) is used as the folder name
    if (componentStrategyOptions.createFolderForEachComponent) {
      component.outputOptions = {
        componentClassName: friendlyComponentName,
        fileName: (customComponentFileName && customComponentFileName(friendlyFileName)) || 'index',
        styleFileName: (customStyleFileName && customStyleFileName(friendlyFileName)) || 'style',
        templateFileName:
          (customTemplateFileName && customTemplateFileName(friendlyFileName)) || 'template',
        folderPath: [...folderPath, friendlyFileName],
      }
    } else {
      component.outputOptions = {
        componentClassName: friendlyComponentName,
        fileName:
          (customComponentFileName && customComponentFileName(friendlyFileName)) ||
          friendlyFileName,
        styleFileName:
          (customStyleFileName && customStyleFileName(friendlyFileName)) || friendlyFileName,
        templateFileName:
          (customTemplateFileName && customTemplateFileName(friendlyFileName)) || friendlyFileName,
        folderPath,
      }
    }

    const otherComponents = Object.keys(components).filter(
      (key) => key !== componentKey && components[key].outputOptions
    )
    deduplicateComponentOutputOptions(
      component.outputOptions,
      otherComponents.map((key) => components[key].outputOptions)
    )
  })
}

const deduplicatePageOptionValues = (options: UIDLPageOptions, otherOptions: UIDLPageOptions[]) => {
  let navlinkSuffix = 0
  while (otherOptions.some((opt) => opt.navLink === appendSuffix(options.navLink, navlinkSuffix))) {
    navlinkSuffix++
  }

  if (navlinkSuffix > 0) {
    options.navLink = appendSuffix(options.navLink, navlinkSuffix)
    console.warn(
      `Potential duplication solved by appending '${navlinkSuffix}' to the navlink: ${options.navLink}`
    )
  }

  let componentNameSuffix = 0
  while (
    otherOptions.some(
      (opt) => opt.componentName === appendSuffix(options.componentName, componentNameSuffix)
    )
  ) {
    componentNameSuffix++
  }

  if (componentNameSuffix > 0) {
    options.componentName = appendSuffix(options.componentName, componentNameSuffix)
    console.warn(
      `Potential duplication solved by appending '${componentNameSuffix}' to the componentName: ${options.componentName}`
    )
  }

  let fileNameSuffix = 0
  while (
    otherOptions.some((opt) => opt.fileName === appendSuffix(options.fileName, fileNameSuffix))
  ) {
    fileNameSuffix++
  }

  if (fileNameSuffix > 0) {
    options.fileName = appendSuffix(options.fileName, fileNameSuffix)
    console.warn(
      `Potential duplication solved by appending '${fileNameSuffix}' to the fileName: ${options.fileName}`
    )
  }
}

const deduplicateComponentOutputOptions = (
  options: UIDLComponentOutputOptions,
  otherOptions: UIDLComponentOutputOptions[]
) => {
  let componentNameSuffix = 0
  while (
    otherOptions.some(
      (opt) =>
        opt.componentClassName === appendSuffix(options.componentClassName, componentNameSuffix) &&
        equalPaths(opt.folderPath, options.folderPath)
    )
  ) {
    componentNameSuffix++
  }

  if (componentNameSuffix > 0) {
    options.componentClassName = appendSuffix(options.componentClassName, componentNameSuffix)
    console.warn(
      `Potential duplication solved by appending a '${componentNameSuffix}' to the component class name: ${options.componentClassName}`
    )
  }

  let fileNameSuffix = 0
  while (
    otherOptions.some(
      (opt) =>
        opt.fileName === appendSuffix(options.fileName, fileNameSuffix) &&
        equalPaths(opt.folderPath, options.folderPath)
    )
  ) {
    fileNameSuffix++
  }

  if (fileNameSuffix > 0) {
    options.fileName = appendSuffix(options.fileName, fileNameSuffix)
    console.warn(
      `Potential duplication solved by appending a '${fileNameSuffix}' to the file name: ${options.fileName}`
    )
  }
}

const appendSuffix = (str: string, suffix: number) => {
  const stringSuffix = suffix === 0 ? '' : suffix.toString()
  return str + stringSuffix
}

const equalPaths = (path1: string[], path2: string[]) => {
  return JSON.stringify(path1) === JSON.stringify(path2)
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
  const componentKey = element.semanticType || element.elementType
  const component = components[componentKey]
  const componentPath = UIDLUtils.getComponentFolderPath(component)
  const componentClassName = UIDLUtils.getComponentClassName(component)

  const toPath = toBasePath.concat(componentPath)

  const importFileName = UIDLUtils.getComponentFileName(component)
  const importPath = generateLocalDependenciesPrefix(fromPath, toPath)
  element.dependency.path = `${importPath}${importFileName}`
  element.elementType = 'component'
  element.semanticType = componentClassName
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

export const fileFileAndReplaceContent = (
  files: GeneratedFile[],
  fileName: string,
  content: string
): GeneratedFile[] => {
  Object.values(files).forEach((file: GeneratedFile) => {
    if (file.name === fileName) {
      file.content = content.concat(file.content)
    }
  })
  return files
}

export const generateExternalCSSImports = async (uidl: ComponentUIDL) => {
  const { importDefinitions = {} } = uidl

  const styleImports = Object.keys(importDefinitions || {}).reduce(
    (acc: Record<string, UIDLExternalDependency>, importRef) => {
      const importedPackage = importDefinitions[importRef]
      if (importedPackage.path.endsWith('.css')) {
        acc[importRef] = importDefinitions[importRef]
        return acc
      }
      return acc
    },
    {}
  )

  const generator = createComponentGenerator()
  const { chunks } = await importStatementsPlugin({
    uidl: null,
    dependencies: styleImports,
    options: {},
    chunks: [],
  })

  return generator.linkCodeChunks({ imports: chunks }, 'imports')
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
