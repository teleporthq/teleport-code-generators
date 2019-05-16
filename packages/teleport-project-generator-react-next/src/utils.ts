import { generator } from '@teleporthq/teleport-generator-shared/lib/generators/js-ast-to-code'
import {
  generateASTDefinitionForJSXTag,
  addAttributeToJSXTag,
  addChildJSXTag,
  addChildJSXText,
} from '@teleporthq/teleport-generator-shared/lib/utils/ast-jsx-utils'
import * as types from '@babel/types'
import { ASSETS_PREFIX } from './constants'
import { prefixPlaygroundAssetsURL } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import {
  createFile,
  // createFolder,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'

import {
  GeneratedFile,
  GeneratedFolder,
  TemplateDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

export const createDocumentComponent = (uidl: ProjectUIDL) => {
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlNode = generateASTDefinitionForJSXTag('html')
  const headNode = generateASTDefinitionForJSXTag('Head')
  const bodyNode = generateASTDefinitionForJSXTag('body')

  const mainNode = generateASTDefinitionForJSXTag('Main')
  const nextScriptNode = generateASTDefinitionForJSXTag('NextScript')
  addChildJSXTag(bodyNode, mainNode)
  addChildJSXTag(bodyNode, nextScriptNode)

  addChildJSXTag(htmlNode, headNode)
  addChildJSXTag(htmlNode, bodyNode)

  if (settings.language) {
    addAttributeToJSXTag(htmlNode, { name: 'lang', value: settings.language })
  }

  if (settings.title) {
    const titleTag = generateASTDefinitionForJSXTag('title')
    addChildJSXText(titleTag, settings.title)
    addChildJSXTag(headNode, titleTag)
  }

  if (manifest) {
    const linkTag = generateASTDefinitionForJSXTag('link')
    addAttributeToJSXTag(linkTag, { name: 'rel', value: 'manifest' })
    addAttributeToJSXTag(linkTag, { name: 'href', value: '/static/manifest.json' })
    addChildJSXTag(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = generateASTDefinitionForJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = prefixPlaygroundAssetsURL(ASSETS_PREFIX, metaItem[key])
      addAttributeToJSXTag(metaTag, { name: key, value: metaValue })
    })
    addChildJSXTag(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixPlaygroundAssetsURL(ASSETS_PREFIX, asset.path)

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = generateASTDefinitionForJSXTag('link')
      addAttributeToJSXTag(linkTag, { name: 'rel', value: 'stylesheet' })
      addAttributeToJSXTag(linkTag, { name: 'href', value: assetPath })
      addChildJSXTag(headNode, linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = generateASTDefinitionForJSXTag('style')
      addAttributeToJSXTag(styleTag, {
        name: 'dangerouslySetInnerHTML',
        value: { __html: asset.content },
      })
      addChildJSXTag(headNode, styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptTag = generateASTDefinitionForJSXTag('script')
      addAttributeToJSXTag(scriptTag, { name: 'type', value: 'text/javascript' })
      if (assetPath) {
        addAttributeToJSXTag(scriptTag, { name: 'src', value: assetPath })
        if (asset.meta && asset.meta.defer) {
          addAttributeToJSXTag(scriptTag, { name: 'defer', value: true })
        }
        if (asset.meta && asset.meta.async) {
          addAttributeToJSXTag(scriptTag, { name: 'async', value: true })
        }
      } else if (asset.content) {
        addAttributeToJSXTag(scriptTag, {
          name: 'dangerouslySetInnerHTML',
          value: { __html: asset.content },
        })
      }

      if (asset.meta && asset.meta.target === 'body') {
        addChildJSXTag(bodyNode, scriptTag)
      } else {
        addChildJSXTag(headNode, scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = generateASTDefinitionForJSXTag('link')
      addAttributeToJSXTag(iconTag, { name: 'rel', value: 'shortcut icon' })
      addAttributeToJSXTag(iconTag, { name: 'href', value: assetPath })

      if (typeof asset.meta === 'object') {
        const assetMeta = asset.meta
        Object.keys(assetMeta).forEach((metaKey) => {
          addAttributeToJSXTag(iconTag, { name: metaKey, value: assetMeta[metaKey] })
        })
      }

      addChildJSXTag(headNode, iconTag)
    }
  })

  // Create AST representation of the class CustomDocument extends Document
  // https://github.com/zeit/next.js#custom-document
  const documentAST = createDocumentASTDefinition(htmlNode)

  // Convert AST to string
  return generator(documentAST)
}

const createDocumentASTDefinition = (htmlNode, t = types) => {
  return t.program([
    t.importDeclaration(
      [
        t.importDefaultSpecifier(t.identifier('Document')),
        t.importSpecifier(t.identifier('Head'), t.identifier('Head')),
        t.importSpecifier(t.identifier('Main'), t.identifier('Main')),
        t.importSpecifier(t.identifier('NextScript'), t.identifier('NextScript')),
      ],
      t.stringLiteral('next/document')
    ),
    t.classDeclaration(
      t.identifier('CustomDocument'),
      t.identifier('Document'),
      t.classBody([
        t.classMethod(
          'method',
          t.identifier('render'),
          [],
          t.blockStatement([t.returnStatement(htmlNode)])
        ),
      ])
    ),
    t.exportDefaultDeclaration(t.identifier('CustomDocument')),
  ])
}

export const createDocumentComponentFile = (uidl: ProjectUIDL): GeneratedFile => {
  const documentComponent = createDocumentComponent(uidl)
  if (!documentComponent) {
    return null
  }

  return createFile('_document', FILE_TYPE.JS, documentComponent)
}

// export const buildFolderStructure = (
//   files: Record<string, GeneratedFile[]>,
//   distFolderName: string
// ): GeneratedFolder => {
//   const pagesFolder = createFolder('pages', files.pages)
//   const componentsFolder = createFolder('components', files.components)
//   const staticFolder = createFolder('static', files.static)

//   return createFolder(distFolderName, files.dist, [pagesFolder, componentsFolder, staticFolder])
// }

export const buildFolderStructure = (
  files: Record<string, GeneratedFile[]>,
  templateDefinition: TemplateDefinition
): GeneratedFolder => {
  const { dist, pages, components } = files

  const { templateFolder } = templateDefinition
  templateFolder.files = templateFolder.files.concat(dist)

  const componentsPath = templateDefinition.meta.componentsPath
  const componentsFolder = componentsPath
    ? findFolderByPath(templateFolder, componentsPath)
    : findFolderByName(templateFolder, 'components')

  componentsFolder.files = componentsFolder.files.concat(components)

  const pagesPath = templateDefinition.meta.pagesPath
  const pagesFolder = pagesPath
    ? findFolderByPath(templateFolder, pagesPath)
    : findFolderByName(templateFolder, 'pages')

  pagesFolder.files = pagesFolder.files.concat(pages)

  return templateFolder
}

const findFolderByName = (rootFolder: GeneratedFolder, folderToFind: string): GeneratedFolder => {
  if (rootFolder.name === folderToFind) {
    return rootFolder
  }

  if (!rootFolder.subFolders.length) {
    return null
  }

  for (const subFolder of rootFolder.subFolders) {
    const foundFolder = findFolderByName(subFolder, folderToFind)
    if (foundFolder) {
      return foundFolder
    }
  }

  return null
}

const findFolderByPath = (rootFolder: GeneratedFolder, folderPath: string[]): GeneratedFolder => {
  if (!folderPath || !folderPath.length) {
    return rootFolder
  }

  const folderPathClone = JSON.parse(JSON.stringify(folderPath))
  const path = folderPathClone.shift()
  const subFolder = rootFolder.subFolders.find((folder) => {
    return folder.name === path
  })

  return subFolder ? findFolderByPath(subFolder, folderPathClone) : null
}
