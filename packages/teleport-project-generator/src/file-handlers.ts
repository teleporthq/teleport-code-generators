import {
  addAttributeToNode,
  addChildNode,
  addTextNode,
  addBooleanAttributeToNode,
} from '@teleporthq/teleport-shared/dist/cjs/utils/html-utils'
import {
  prefixPlaygroundAssetsURL,
  extractPageMetadata,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { slugify } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { createHTMLNode } from '@teleporthq/teleport-shared/dist/cjs/builders/html-builders'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

import {
  GeneratedFile,
  GeneratedFolder,
  ProjectUIDL,
  WebManifest,
  ChunkDefinition,
  ComponentUIDL,
  GeneratorOptions,
  UIDLConditionalNode,
} from '@teleporthq/teleport-types'

import { DEFAULT_PACKAGE_JSON, DEFAULT_ROUTER_FILE_NAME } from './constants'
import { EntryFileOptions, PackageJSON, ProjectStrategy } from './types'
import { generateLocalDependenciesPrefix } from './utils'

export const createPage = async (
  routeNode: UIDLConditionalNode,
  strategy: ProjectStrategy,
  options: GeneratorOptions
) => {
  const { value, node } = routeNode.content
  const pageName = value.toString()

  const { componentName, fileName } = extractPageMetadata(
    options.projectRouteDefinition,
    pageName,
    strategy.pages.metaDataOptions
  )

  const pageUIDL = {
    name: componentName,
    node,
    meta: {
      fileName,
    },
  }

  return strategy.pages.generator.generateComponent(pageUIDL, options)
}

export const createComponent = async (
  componentUIDL: ComponentUIDL,
  strategy: ProjectStrategy,
  options: GeneratorOptions
) => {
  return strategy.components.generator.generateComponent(componentUIDL, options)
}

export const createRouterFile = async (root: ComponentUIDL, strategy: ProjectStrategy) => {
  const { generator: routerGenerator, path: routerFilePath, fileName } = strategy.router
  const routerLocalDependenciesPrefix = generateLocalDependenciesPrefix(
    routerFilePath,
    strategy.pages.path
  )
  const options = {
    localDependenciesPrefix: routerLocalDependenciesPrefix,
    meta: strategy.router.metaDataOptions,
  }

  root.meta = root.meta || {}
  root.meta.fileName = fileName || DEFAULT_ROUTER_FILE_NAME

  const { files } = await routerGenerator.generateComponent(root, options)
  return files[0]
}

export const createEntryFile = async (
  uidl: ProjectUIDL,
  strategy: ProjectStrategy,
  { assetsPrefix }: GeneratorOptions
) => {
  // If no function is provided in the strategy, the createHTMLEntryFileChunks is used by default
  const chunkGenerationFunction =
    strategy.entry.chunkGenerationFunction || createHTMLEntryFileChunks
  const appRootOverride = strategy.entry.appRootOverride || null
  const entryFileName = strategy.entry.fileName || 'index'
  const chunks = chunkGenerationFunction(uidl, { assetsPrefix, appRootOverride })

  const [entryFile] = strategy.entry.generator.linkCodeChunks(chunks, entryFileName)
  return entryFile
}

// Default function used to generate the html file based on the global settings in the ProjectUIDL
const createHTMLEntryFileChunks = (uidl: ProjectUIDL, options: EntryFileOptions) => {
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
      const scriptInBody = (asset.options && asset.options.target === 'body') || false
      const scriptTag = createHTMLNode('script')
      // addTextNode(scriptTag, ' ') // To ensure tag is not automatically self-closing, which causes problems in the <head>
      addAttributeToNode(scriptTag, 'type', 'text/javascript')
      if (assetPath) {
        addAttributeToNode(scriptTag, 'src', assetPath)
        if (asset.options && asset.options.defer) {
          addBooleanAttributeToNode(scriptTag, 'defer')
        }
        if (asset.options && asset.options.async) {
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

      if (asset.options && asset.options.iconType) {
        addAttributeToNode(iconTag, 'type', asset.options.iconType)
      }
      if (asset.options && asset.options.iconSizes) {
        addAttributeToNode(iconTag, 'sizes', asset.options.iconSizes)
      }
      addChildNode(headNode, iconTag)
    }
  })

  const chunks: Record<string, ChunkDefinition[]> = {
    [FILE_TYPE.HTML]: [
      {
        name: 'doctype',
        type: CHUNK_TYPE.STRING,
        fileId: FILE_TYPE.HTML,
        content: '<!DOCTYPE>',
        linkAfter: [],
      },
      {
        name: 'html-node',
        type: CHUNK_TYPE.HAST,
        fileId: FILE_TYPE.HTML,
        content: htmlNode,
        linkAfter: ['doctype'],
      },
    ],
  }

  return chunks
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

  return {
    name: 'manifest',
    fileType: FILE_TYPE.JSON,
    content: JSON.stringify(content, null, 2),
  }
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

    template.files.push({
      name: 'package',
      fileType: FILE_TYPE.JSON,
      content: JSON.stringify(content, null, 2),
    })
  }
}
