import { generator } from '../generators/html-to-string'
import {
  createHTMLNode,
  addAttributeToNode,
  addChildNode,
  addTextNode,
  addBooleanAttributeToNode,
} from './html-utils'

import { prefixPlaygroundAssetsURL, extractPageMetadata } from './uidl-utils'
import { slugify } from './string-utils'
import { FILE_TYPE } from '../constants'

import {
  GeneratedFile,
  PackageJSON,
  ComponentFactoryParams,
  ComponentGeneratorOutput,
  GeneratedFolder,
  TemplateDefinition,
} from '../typings/generators'

import { ProjectUIDL, WebManifest, ComponentUIDL } from '../typings/uidl'

interface HtmlIndexFileOptions {
  assetsPrefix?: string
  fileName?: string
  appRootOverride?: string
}

export const createHtmlIndexFile = (
  uidl: ProjectUIDL,
  options: HtmlIndexFileOptions
): GeneratedFile => {
  const { assetsPrefix = '', fileName = 'index', appRootOverride } = options
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

  const htmlInnerString = generator(htmlNode)
  const content = `
    <!DOCTYPE html>
    ${htmlInnerString}`

  return createFile(fileName, FILE_TYPE.HTML, content)
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

export const createPackageJSONFile = (
  packageJSONTemplate: PackageJSON,
  overwrites: {
    dependencies: Record<string, string>
    projectName: string
  }
): GeneratedFile => {
  const { projectName, dependencies } = overwrites

  const content: PackageJSON = {
    ...packageJSONTemplate,
    name: slugify(projectName),
    dependencies: {
      ...packageJSONTemplate.dependencies,
      ...dependencies,
    },
  }

  return createFile('package', FILE_TYPE.JSON, JSON.stringify(content, null, 2))
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
  const { componentGenerator, componentUIDL, componentOptions } = params

  let files: GeneratedFile[] = []
  let dependencies: Record<string, string> = {}

  try {
    const compiledComponent = await componentGenerator.generateComponent(componentUIDL, {
      ...componentOptions,
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

interface LocalDependenciesMeta {
  defaultComponentsPath: string | string[]
  defaultPagesPath: string | string[]
}

export const generateLocalDependenciesPrefix = (
  template: TemplateDefinition,
  meta: LocalDependenciesMeta
): string => {
  const initialComponentsPath =
    template.meta && template.meta.componentsPath
      ? template.meta.componentsPath
      : [].concat(meta.defaultComponentsPath)

  const initialPagesPath =
    template.meta && template.meta.pagesPath
      ? template.meta.pagesPath
      : [].concat(meta.defaultPagesPath)

  let dependencyPrefix = ''

  /*
    Remove common path elements from the beginning of the
    components and pages full path (if any)
  
    For example, having:
    - initialComponentsPath = ['src', 'components']
    - initialPagesPath = ['src', 'pages']
  
    If we want to have an import statement that goes from the pages folder to the
    components folder, we only need to go back one step, so we are removing
    the forst element from both the paths ('src') and build the dependencyPrefix accordingly
  */
  const { componentsPath, pagesPath } = removeCommonStartingPointsFromPaths(
    initialComponentsPath,
    initialPagesPath
  )

  // We have to go back as many folders as there are defined in the pages path
  dependencyPrefix += '../'.repeat(pagesPath.length)

  dependencyPrefix += componentsPath
    .map((component) => {
      return `${component}/`
    })
    .join('')

  return dependencyPrefix
}

const removeCommonStartingPointsFromPaths = (
  componentsPath: string[],
  pagesPath: string[]
): { componentsPath: string[]; pagesPath: string[] } => {
  const componentsPathLength =
    componentsPath.length > pagesPath.length ? componentsPath.length : pagesPath.length

  let i = 0
  let isEqual = true
  while (i < componentsPathLength && isEqual) {
    if (componentsPath[i] === pagesPath[i]) {
      componentsPath.shift()
      pagesPath.shift()
    } else {
      isEqual = false
    }
    i += 1
  }

  return { componentsPath, pagesPath }
}

export const injectFilesToPath = (
  rootFolder: GeneratedFolder,
  path: string[],
  files: GeneratedFile[]
): GeneratedFolder => {
  let folder = findFolderByPath(rootFolder, path)

  if (!folder) {
    const { updatedRootFolder, createdFolder } = createFolderByPath(rootFolder, path)
    rootFolder = updatedRootFolder
    folder = createdFolder
  }

  folder.files = folder.files.concat(files)
  return rootFolder
}

interface NewGeneratedFolderResponse {
  updatedRootFolder: GeneratedFolder
  createdFolder: GeneratedFolder
}

const createFolderByPath = (
  rootFolder: GeneratedFolder,
  folderPath: string | string[]
): NewGeneratedFolderResponse => {
  folderPath = [].concat(folderPath)
  const rootFolderClone = JSON.parse(JSON.stringify(rootFolder))

  let createdFolder = null
  let currentFolder = rootFolderClone

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

  return {
    createdFolder,
    updatedRootFolder: rootFolderClone,
  }
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
