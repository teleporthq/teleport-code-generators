import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { HASTUtils, HASTBuilers } from '@teleporthq/teleport-plugin-common'

import {
  GeneratedFile,
  GeneratedFolder,
  ProjectUIDL,
  WebManifest,
  ChunkDefinition,
  ComponentUIDL,
  GeneratorOptions,
  ProjectStrategy,
  EntryFileOptions,
  CustomTag,
  Attribute,
  FileType,
  ChunkType,
} from '@teleporthq/teleport-types'

import { DEFAULT_PACKAGE_JSON, DEFAULT_ROUTER_FILE_NAME } from './constants'
import { PackageJSON } from './types'
import { generateLocalDependenciesPrefix } from './utils'

export const createPage = async (
  pageUIDL: ComponentUIDL,
  strategy: ProjectStrategy,
  options: GeneratorOptions
) => {
  return strategy.pages.generator.generateComponent(pageUIDL, options)
}

export const createComponent = async (
  componentUIDL: ComponentUIDL,
  strategy: ProjectStrategy,
  options: GeneratorOptions
) => {
  return strategy.components.generator.generateComponent(componentUIDL, options)
}

export const createComponentModule = async (uidl: ProjectUIDL, strategy: ProjectStrategy) => {
  const { root } = uidl
  const { path } = strategy.components
  const { moduleGenerator } = strategy.components
  const componentLocalDependenciesPrefix = generateLocalDependenciesPrefix(
    path,
    strategy.components.path
  )

  const options = {
    localDependenciesPrefix: componentLocalDependenciesPrefix,
    strategy,
    moduleComponents: uidl.components,
  }

  root.outputOptions = root.outputOptions || {}
  root.outputOptions.fileName = 'components.module'

  const { files } = await moduleGenerator.generateComponent(root, options)
  return files[0]
}

export const createPageModule = async (
  pageUIDL: ComponentUIDL,
  strategy: ProjectStrategy,
  options: GeneratorOptions
) => {
  pageUIDL.outputOptions = pageUIDL.outputOptions || {}
  pageUIDL.outputOptions.moduleName = `${StringUtils.dashCaseToUpperCamelCase(
    pageUIDL.outputOptions.folderPath[0]
  )}Module`
  return strategy.pages.moduleGenerator.generateComponent(pageUIDL, options)
}

export const createRouterFile = async (root: ComponentUIDL, strategy: ProjectStrategy) => {
  const { generator: routerGenerator, path: routerFilePath, fileName } = strategy.router
  const routerLocalDependenciesPrefix = generateLocalDependenciesPrefix(
    routerFilePath,
    strategy.pages.path
  )

  const options = {
    localDependenciesPrefix: routerLocalDependenciesPrefix,
    strategy,
  }

  root.outputOptions = root.outputOptions || {}
  root.outputOptions.fileName = fileName || DEFAULT_ROUTER_FILE_NAME

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
  const { options } = strategy.entry

  const appRootOverride = (options && options.appRootOverride) || null
  const entryFileName = strategy.entry.fileName || 'index'
  const customHeadContent = (options && options.customHeadContent) || null
  const customTags = (options && options.customTags) || []
  const chunks = chunkGenerationFunction(uidl, {
    assetsPrefix,
    appRootOverride,
    customHeadContent,
    customTags,
  })

  const [entryFile] = strategy.entry.generator.linkCodeChunks(chunks, entryFileName)
  return entryFile
}

// Default function used to generate the html file based on the global settings in the ProjectUIDL
const createHTMLEntryFileChunks = (uidl: ProjectUIDL, options: EntryFileOptions) => {
  const { assetsPrefix = '', appRootOverride, customHeadContent, customTags } = options
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlNode = HASTBuilers.createHTMLNode('html')
  const headNode = HASTBuilers.createHTMLNode('head')
  const bodyNode = HASTBuilers.createHTMLNode('body')

  HASTUtils.addChildNode(htmlNode, headNode)
  HASTUtils.addChildNode(htmlNode, bodyNode)

  // Vue and React use a standard <div id="app"/> in the body tag.
  // Nuxt has an internal templating so requires an override
  if (appRootOverride) {
    HASTUtils.addTextNode(bodyNode, appRootOverride)
  } else {
    const appRootNode = HASTBuilers.createHTMLNode('div')
    HASTUtils.addAttributeToNode(appRootNode, 'id', 'app')
    HASTUtils.addChildNode(bodyNode, appRootNode)
  }

  if (settings.language) {
    HASTUtils.addAttributeToNode(htmlNode, 'lang', settings.language)
  }

  if (settings.title) {
    const titleTag = HASTBuilers.createHTMLNode('title')
    HASTUtils.addTextNode(titleTag, settings.title)
    HASTUtils.addChildNode(headNode, titleTag)
  }

  /* For frameworks that need to inject and point out the generated build files
  or adding some script tags in head or body */
  if (customTags.length > 0) {
    customTags.forEach((tag: CustomTag) => {
      const { targetTag, tagName, attributes, content } = tag
      const targetNode = targetTag === 'head' ? headNode : bodyNode
      const createdNode = HASTBuilers.createHTMLNode(tagName)

      if (content) {
        HASTUtils.addTextNode(createdNode, content)
      }

      if (attributes && attributes.length > 0) {
        attributes.forEach((attribute: Attribute) => {
          const { attributeKey, attributeValue } = attribute
          if (attributeValue) {
            HASTUtils.addAttributeToNode(createdNode, attributeKey, attributeValue)
          } else {
            HASTUtils.addBooleanAttributeToNode(createdNode, attributeKey)
          }
        })
      }

      HASTUtils.addChildNode(targetNode, createdNode)
    })
  }

  if (manifest) {
    const linkTag = HASTBuilers.createHTMLNode('link')
    HASTUtils.addAttributeToNode(linkTag, 'rel', 'manifest')
    HASTUtils.addAttributeToNode(linkTag, 'href', `${options.assetsPrefix}/manifest.json`)
    HASTUtils.addChildNode(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = HASTBuilers.createHTMLNode('meta')
    Object.keys(metaItem).forEach((key) => {
      const prefixedURL = UIDLUtils.prefixAssetsPath(assetsPrefix, metaItem[key])
      HASTUtils.addAttributeToNode(metaTag, key, prefixedURL)
    })
    HASTUtils.addChildNode(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = UIDLUtils.prefixAssetsPath(assetsPrefix, asset.path)

    // link canonical for SEO
    if (asset.type === 'canonical' && assetPath) {
      const linkTag = HASTBuilers.createHTMLNode('link')
      HASTUtils.addAttributeToNode(linkTag, 'rel', 'canonical')
      HASTUtils.addAttributeToNode(linkTag, 'href', assetPath)
      HASTUtils.addChildNode(headNode, linkTag)
    }

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = HASTBuilers.createHTMLNode('link')
      HASTUtils.addAttributeToNode(linkTag, 'rel', 'stylesheet')
      HASTUtils.addAttributeToNode(linkTag, 'href', assetPath)
      HASTUtils.addChildNode(headNode, linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = HASTBuilers.createHTMLNode('style')
      HASTUtils.addTextNode(styleTag, asset.content)
      HASTUtils.addChildNode(headNode, styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptInBody = (asset.options && asset.options.target === 'body') || false
      const scriptTag = HASTBuilers.createHTMLNode('script')
      HASTUtils.addAttributeToNode(scriptTag, 'type', 'text/javascript')
      if (assetPath) {
        HASTUtils.addAttributeToNode(scriptTag, 'src', assetPath)
        if (asset.options && asset.options.defer) {
          HASTUtils.addBooleanAttributeToNode(scriptTag, 'defer')
        }
        if (asset.options && asset.options.async) {
          HASTUtils.addBooleanAttributeToNode(scriptTag, 'async')
        }
      } else if (asset.content) {
        HASTUtils.addTextNode(scriptTag, asset.content)
      }
      if (scriptInBody) {
        HASTUtils.addChildNode(bodyNode, scriptTag)
      } else {
        HASTUtils.addChildNode(headNode, scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = HASTBuilers.createHTMLNode('link')
      HASTUtils.addAttributeToNode(iconTag, 'rel', 'shortcut icon')
      HASTUtils.addAttributeToNode(iconTag, 'href', assetPath)

      if (asset.options && asset.options.iconType) {
        HASTUtils.addAttributeToNode(iconTag, 'type', asset.options.iconType)
      }
      if (asset.options && asset.options.iconSizes) {
        HASTUtils.addAttributeToNode(iconTag, 'sizes', asset.options.iconSizes)
      }
      HASTUtils.addChildNode(headNode, iconTag)
    }
  })

  if (customHeadContent) {
    HASTUtils.addTextNode(headNode, customHeadContent)
  }

  const chunks: Record<string, ChunkDefinition[]> = {
    [FileType.HTML]: [
      {
        name: 'doctype',
        type: ChunkType.STRING,
        fileType: FileType.HTML,
        content: '<!DOCTYPE html>',
        linkAfter: [],
      },
      {
        name: 'html-node',
        type: ChunkType.HAST,
        fileType: FileType.HTML,
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
    const src = UIDLUtils.prefixAssetsPath(assetsPrefix || '', icon.src)
    return { ...icon, src }
  })

  const content = {
    ...defaultManifest,
    ...manifest,
    ...{ icons },
  }

  return {
    name: 'manifest',
    fileType: FileType.JSON,
    content: JSON.stringify(content, null, 2),
  }
}

export const handlePackageJSON = (
  template: GeneratedFolder,
  uidl: ProjectUIDL,
  dependencies: Record<string, string>
) => {
  const inputPackageJSONFile = template.files.find(
    (file) => file.name === 'package' && file.fileType === FileType.JSON
  )

  if (inputPackageJSONFile) {
    const packageJSONContent = JSON.parse(inputPackageJSONFile.content) as PackageJSON

    packageJSONContent.name = StringUtils.slugify(uidl.name)
    packageJSONContent.dependencies = {
      ...packageJSONContent.dependencies,
      ...dependencies,
    }

    inputPackageJSONFile.content = JSON.stringify(packageJSONContent, null, 2)
  } else {
    const content: PackageJSON = {
      ...DEFAULT_PACKAGE_JSON,
      name: StringUtils.slugify(uidl.name),
      dependencies,
    }

    template.files.push({
      name: 'package',
      fileType: FileType.JSON,
      content: JSON.stringify(content, null, 2),
    })
  }
}
