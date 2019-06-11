import {
  createHTMLNode,
  addAttributeToNode,
  addChildNode,
  addTextNode,
  addBooleanAttributeToNode,
} from '@teleporthq/teleport-shared/lib/utils/html-utils'

import {
  prefixPlaygroundAssetsURL,
  extractPageMetadata,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'

import { slugify } from '@teleporthq/teleport-shared/lib/utils/string-utils'

import {
  GeneratedFile,
  ComponentFactoryParams,
  ComponentGeneratorOutput,
  GeneratedFolder,
  HastNode,
  ProjectUIDL,
  WebManifest,
  ComponentUIDL,
  PackageJSON,
} from '@teleporthq/teleport-types'

import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import { DEFAULT_PACKAGE_JSON } from './constants'
import { EntryFileOptions } from './types'

export const createHtmlIndexFile = (uidl: ProjectUIDL, options: EntryFileOptions): HastNode => {
  const { assetsPrefix = '', appRootOverride } = options
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlNode = createHTMLNode('html')
  const headNode = createHTMLNode('head')
  const bodyNode = createHTMLNode('body')

  addChildNode(htmlNode, headNode)
  addChildNode(htmlNode, bodyNode)

  // Vue and React use a standard <div id="app"/> in the body tag.
  // Nuxt has an internal templating so requires an override
  if (appRootOverride) {
    addTextNode(bodyNode, appRootOverride)
  } else {
    const appRootNode = createHTMLNode('div')
    addAttributeToNode(appRootNode, 'id', 'app')
    addChildNode(bodyNode, appRootNode)
  }

  if (settings.language) {
    addAttributeToNode(htmlNode, 'lang', settings.language)
  }

  if (settings.title) {
    const titleTag = createHTMLNode('title')
    addTextNode(titleTag, settings.title)
    addChildNode(headNode, titleTag)
  }

  if (manifest) {
    const linkTag = createHTMLNode('link') // , { selfClosing: true })
    addAttributeToNode(linkTag, 'rel', 'manifest')
    addAttributeToNode(linkTag, 'href', '/static/manifest.json')
    addChildNode(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = createHTMLNode('meta') // , { selfClosing: true })
    Object.keys(metaItem).forEach((key) => {
      const prefixedURL = prefixPlaygroundAssetsURL(assetsPrefix, metaItem[key])
      addAttributeToNode(metaTag, key, prefixedURL)
    })
    addChildNode(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixPlaygroundAssetsURL(assetsPrefix, asset.path)

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = createHTMLNode('link') // , { selfClosing: true })
      addAttributeToNode(linkTag, 'rel', 'stylesheet')
      addAttributeToNode(linkTag, 'href', assetPath)
      addChildNode(headNode, linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = createHTMLNode('style')
      addTextNode(styleTag, asset.content)
      addChildNode(headNode, styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptInBody = (asset.meta && asset.meta.target === 'body') || false
      const scriptTag = createHTMLNode('script')
      // addTextNode(scriptTag, ' ') // To ensure tag is not automatically self-closing, which causes problems in the <head>
      addAttributeToNode(scriptTag, 'type', 'text/javascript')
      if (assetPath) {
        addAttributeToNode(scriptTag, 'src', assetPath)
        if (asset.meta && asset.meta.defer) {
          addBooleanAttributeToNode(scriptTag, 'defer')
        }
        if (asset.meta && asset.meta.async) {
          addBooleanAttributeToNode(scriptTag, 'async')
        }
      } else if (asset.content) {
        addTextNode(scriptTag, asset.content)
      }
      if (scriptInBody) {
        addChildNode(bodyNode, scriptTag)
      } else {
        addChildNode(headNode, scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = createHTMLNode('link') // , { selfClosing: true })
      addAttributeToNode(iconTag, 'rel', 'shortcut icon')
      addAttributeToNode(iconTag, 'href', assetPath)
      if (typeof asset.meta === 'object') {
        const assetMeta = asset.meta
        Object.keys(assetMeta).forEach((metaKey) => {
          addAttributeToNode(iconTag, metaKey, assetMeta[metaKey])
        })
      }
      addChildNode(headNode, iconTag)
    }
  })

  return htmlNode
}

// Creates a manifest json file with the UIDL having priority over the default values
export const createManifestJSONFile = (uidl: ProjectUIDL, assetsPrefix?: string): GeneratedFile => {
  const manifest = uidl.globals.manifest
  const projectName = uidl.name
  const defaultManifest: WebManifest = {
    short_name: projectName,
    name: projectName,
    display: 'standalone',
    start_url: '/',
  }

  const icons = manifest.icons.map((icon) => {
    const src = prefixPlaygroundAssetsURL(assetsPrefix || '', icon.src)
    return { ...icon, src }
  })

  const content = {
    ...defaultManifest,
    ...manifest,
    ...{ icons },
  }

  return createFile('manifest', FILE_TYPE.JSON, JSON.stringify(content, null, 2))
}

export const handlePackageJSON = (
  template: GeneratedFolder,
  uidl: ProjectUIDL,
  dependencies: Record<string, string>
) => {
  const inputPackageJSONFile = template.files.find(
    (file) => file.name === 'package' && file.fileType === FILE_TYPE.JSON
  )

  if (inputPackageJSONFile) {
    const packageJSONContent = JSON.parse(inputPackageJSONFile.content) as PackageJSON

    packageJSONContent.name = slugify(uidl.name)
    packageJSONContent.dependencies = {
      ...packageJSONContent.dependencies,
      ...dependencies,
    }

    inputPackageJSONFile.content = JSON.stringify(packageJSONContent, null, 2)
  } else {
    const content: PackageJSON = {
      ...DEFAULT_PACKAGE_JSON,
      name: slugify(uidl.name),
      dependencies,
    }

    const packageFile = createFile('package', FILE_TYPE.JSON, JSON.stringify(content, null, 2))
    template.files.push(packageFile)
  }
}

export const createPageOutputs = async (
  params: ComponentFactoryParams
): Promise<ComponentGeneratorOutput> => {
  const { componentUIDL, metadataOptions } = params

  const { name: pageName, node } = componentUIDL
  const { route: routeDefinitions } = componentUIDL.stateDefinitions

  const { componentName, fileName } = extractPageMetadata(routeDefinitions, pageName, {
    ...metadataOptions,
  })

  const pageUIDL: ComponentUIDL = {
    name: componentName,
    node,
    meta: {
      fileName,
    },
  }

  return createComponentOutputs({ ...params, componentUIDL: pageUIDL })
}

export const createComponentOutputs = async (
  params: ComponentFactoryParams
): Promise<ComponentGeneratorOutput> => {
  const { componentGenerator, componentUIDL, generatorOptions } = params

  let files: GeneratedFile[] = []
  let dependencies: Record<string, string> = {}

  try {
    const compiledComponent = await componentGenerator.generateComponent(componentUIDL, {
      ...generatorOptions,
      skipValidation: true,
    })

    files = compiledComponent.files
    dependencies = compiledComponent.dependencies
  } catch (error) {
    console.warn(`Error on generating "${componentUIDL.name}" component\n`, error.stack)
  }

  return { files, dependencies }
}

export const joinGeneratorOutputs = (
  generatorOutputs: ComponentGeneratorOutput[]
): ComponentGeneratorOutput => {
  return generatorOutputs.reduce(
    (result, generatorOutput) => {
      const { dependencies, files } = result

      return {
        files: files.concat(generatorOutput.files),
        dependencies: {
          ...dependencies,
          ...generatorOutput.dependencies,
        },
      }
    },
    { dependencies: {}, files: [] }
  )
}

export const createFile = (name: string, fileType: string, content: string): GeneratedFile => {
  return { name, fileType, content }
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
  let dependencyPrefix = '' + '../'.repeat(firstPath.length)

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

  folder.files = folder.files.concat(files)
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
