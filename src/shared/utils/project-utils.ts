import { generator } from '../../core/builder/generators/html-to-string'
import {
  createHTMLNode,
  addAttributeToNode,
  addChildNode,
  addTextNode,
  addBooleanAttributeToNode,
} from './html-utils'

import { prefixPlaygroundAssetsURL, extractPageMetadata } from './uidl-utils'
import { slugify, sanitizeVariableName } from './string-utils'
import { FILE_EXTENSIONS } from '../constants'

export const createHtmlIndex = (
  uidl: ProjectUIDL,
  assetsPrefix: string,
  appRootOverride?: string
) => {
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
  return `
    <!DOCTYPE html>
    ${htmlInnerString}`
}

export const createHtmlIndexFile = (
  uidl: ProjectUIDL,
  assetsPrefix: string,
  fileName: string = 'index',
  appRootOverride?: string
): GeneratedFile => {
  const content = createHtmlIndex(uidl, assetsPrefix, appRootOverride)
  return createFile(fileName, FILE_EXTENSIONS.HTML, content)
}

// Creates a manifest json with the UIDL having priority over the default values
export const createManifestJSON = (
  manifest: WebManifest,
  projectName: string,
  assetsPrefix?: string
) => {
  const defaultManifest: WebManifest = {
    short_name: projectName,
    name: projectName,
    display: 'standalone',
    start_url: '/',
  }

  const icons = manifest.icons.map((icon) => {
    const src = prefixPlaygroundAssetsURL(assetsPrefix, icon.src)
    return { ...icon, src }
  })

  return {
    ...defaultManifest,
    ...manifest,
    ...{ icons },
  }
}

export const createManifestJSONFile = (
  uidl: ProjectUIDL,
  assetsPrefix?: string
): GeneratedFile | [] => {
  if (!uidl.globals.manifest) {
    return []
  }

  const content = createManifestJSON(uidl.globals.manifest, uidl.name, assetsPrefix)
  return createFile('manifest', FILE_EXTENSIONS.JSON, JSON.stringify(content, null, 2))
}

export const createPackageJSON = (
  packageJSONTemplate: PackageJSON,
  overwrites: {
    dependencies: Record<string, string>
    projectName: string
  }
): PackageJSON => {
  const { projectName, dependencies } = overwrites

  return {
    ...packageJSONTemplate,
    name: slugify(projectName),
    dependencies: {
      ...packageJSONTemplate.dependencies,
      ...dependencies,
    },
  }
}

export const createPackageJSONFile = (
  packageJSONTemplate: PackageJSON,
  overwrites: {
    dependencies: Record<string, string>
    projectName: string
  }
): GeneratedFile => {
  const content = createPackageJSON(packageJSONTemplate, overwrites)

  return createFile('package', FILE_EXTENSIONS.JSON, JSON.stringify(content, null, 2))
}

export const createPageFile = async (params: PageFactoryParams): Promise<GeneratedProjectData> => {
  const {
    componentGenerator,
    stateBranch,
    routerDefinitions,
    componentOptions: options,
    pageMetadataOptions,
    pageExtension,
  } = params

  const files: GeneratedFile[] = []
  let dependencies: Record<string, string> = {}
  const { value, content } = stateBranch

  if (typeof value !== 'string' || typeof content === 'string' || !routerDefinitions) {
    return { files, dependencies }
  }

  const { componentName, fileName } = extractPageMetadata(routerDefinitions, value, {
    ...pageMetadataOptions,
  })
  const pageUIDL = createComponentUIDL(componentName, content, { fileName })

  try {
    const compiledPageComponent = await componentGenerator.generateComponent(pageUIDL, {
      ...options,
    })
    const { externalCSS, externalDependencies, code } = compiledPageComponent
    dependencies = externalDependencies

    if (externalCSS) {
      const cssFile = createFile(fileName, FILE_EXTENSIONS.CSS, externalCSS)
      files.push(cssFile)
    }

    const fileExtension = pageExtension || FILE_EXTENSIONS.JS
    const pageFile = createFile(fileName, fileExtension, code)
    files.push(pageFile)
  } catch (error) {
    console.warn(componentName, error)
  }

  return { files, dependencies }
}

export const createComponentFile = async (
  params: ComponentFactoryParams
): Promise<GeneratedProjectData> => {
  let dependencies: Record<string, string> = {}
  const files: GeneratedFile[] = []
  const { componentGenerator, componentUIDL, componentExtension, componentOptions } = params

  try {
    const compiledComponent = await componentGenerator.generateComponent(componentUIDL, {
      ...componentOptions,
    })

    const { code, externalCSS, externalDependencies } = compiledComponent
    const fileName = sanitizeVariableName(componentUIDL.name)
    dependencies = externalDependencies

    if (externalCSS) {
      const cssFile = createFile(fileName, FILE_EXTENSIONS.CSS, externalCSS)
      files.push(cssFile)
    }

    const fileExtension = componentExtension || FILE_EXTENSIONS.JS
    const componentFile = createFile(fileName, fileExtension, code)
    files.push(componentFile)
  } catch (error) {
    console.warn(componentUIDL.name, error)
  }
  return { files, dependencies }
}

function createComponentUIDL(
  name: string,
  content: ContentNode,
  meta: Record<string, any>
): ComponentUIDL {
  return {
    name,
    content,
    meta: {
      ...meta,
    },
  }
}

export const joinComponentFiles = (
  componentFiles: GeneratedProjectData[]
): GeneratedProjectData => {
  let dependencies = {}

  const files = componentFiles.reduce((componentFile: GeneratedFile[], currentFile) => {
    dependencies = {
      ...dependencies,
      ...currentFile.dependencies,
    }
    return componentFile.concat(currentFile.files)
  }, [])

  return { files, dependencies }
}

export const createFile = (name: string, extension: string, content: string): GeneratedFile => {
  return { name, extension, content }
}

export const createFolder = (
  name: string,
  files: GeneratedFile[] = [],
  subFolders: GeneratedFolder[] = []
): GeneratedFolder => {
  return {
    name,
    files,
    subFolders,
  }
}
