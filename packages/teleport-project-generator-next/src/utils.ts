import { ASTUtils, ASTBuilders, UIDLUtils } from '@teleporthq/teleport-shared'

import * as types from '@babel/types'

import {
  ProjectUIDL,
  ChunkDefinition,
  EntryFileOptions,
  FileType,
  ChunkType,
} from '@teleporthq/teleport-types'

export const createDocumentFileChunks = (uidl: ProjectUIDL, options: EntryFileOptions) => {
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlNode = ASTBuilders.createJSXTag('html')
  const headNode = ASTBuilders.createJSXTag('Head')
  const bodyNode = ASTBuilders.createJSXTag('body')

  const mainNode = ASTBuilders.createJSXTag('Main')
  const nextScriptNode = ASTBuilders.createJSXTag('NextScript')
  ASTUtils.addChildJSXTag(bodyNode, mainNode)
  ASTUtils.addChildJSXTag(bodyNode, nextScriptNode)

  ASTUtils.addChildJSXTag(htmlNode, headNode)
  ASTUtils.addChildJSXTag(htmlNode, bodyNode)

  if (settings.language) {
    ASTUtils.addAttributeToJSXTag(htmlNode, 'lang', settings.language)
  }

  // NOTE: Title is added in per page, not in the layout file

  if (manifest) {
    const linkTag = ASTBuilders.createJSXTag('link')
    ASTUtils.addAttributeToJSXTag(linkTag, 'rel', 'manifest')
    ASTUtils.addAttributeToJSXTag(linkTag, 'href', `${options.assetsPrefix}/manifest.json`)
    ASTUtils.addChildJSXTag(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = ASTBuilders.createJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = UIDLUtils.prefixAssetsPath(options.assetsPrefix, metaItem[key])
      ASTUtils.addAttributeToJSXTag(metaTag, key, metaValue)
    })
    ASTUtils.addChildJSXTag(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = UIDLUtils.prefixAssetsPath(options.assetsPrefix, asset.path)

    // link canonical for SEO
    if (asset.type === 'canonical' && assetPath) {
      const linkTag = ASTBuilders.createJSXTag('link')
      ASTUtils.addAttributeToJSXTag(linkTag, 'rel', 'canonical')
      ASTUtils.addAttributeToJSXTag(linkTag, 'href', assetPath)
      ASTUtils.addChildJSXTag(headNode, linkTag)
    }

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = ASTBuilders.createJSXTag('link')
      ASTUtils.addAttributeToJSXTag(linkTag, 'rel', 'stylesheet')
      ASTUtils.addAttributeToJSXTag(linkTag, 'href', assetPath)
      ASTUtils.addChildJSXTag(headNode, linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = ASTBuilders.createJSXTag('style')
      ASTUtils.addAttributeToJSXTag(styleTag, 'dangerouslySetInnerHTML', { __html: asset.content })
      ASTUtils.addChildJSXTag(headNode, styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptTag = ASTBuilders.createJSXTag('script')
      ASTUtils.addAttributeToJSXTag(scriptTag, 'type', 'text/javascript')
      if (assetPath) {
        ASTUtils.addAttributeToJSXTag(scriptTag, 'src', assetPath)
        if (asset.options && asset.options.defer) {
          ASTUtils.addAttributeToJSXTag(scriptTag, 'defer', true)
        }
        if (asset.options && asset.options.async) {
          ASTUtils.addAttributeToJSXTag(scriptTag, 'async', true)
        }
      } else if (asset.content) {
        ASTUtils.addAttributeToJSXTag(scriptTag, 'dangerouslySetInnerHTML', {
          __html: asset.content,
        })
      }

      if (asset.options && asset.options.target === 'body') {
        ASTUtils.addChildJSXTag(bodyNode, scriptTag)
      } else {
        ASTUtils.addChildJSXTag(headNode, scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = ASTBuilders.createJSXTag('link')
      ASTUtils.addAttributeToJSXTag(iconTag, 'rel', 'shortcut icon')
      ASTUtils.addAttributeToJSXTag(iconTag, 'href', assetPath)

      if (asset.options && asset.options.iconType) {
        ASTUtils.addAttributeToJSXTag(iconTag, 'type', asset.options.iconType)
      }
      if (asset.options && asset.options.iconSizes) {
        ASTUtils.addAttributeToJSXTag(iconTag, 'sizes', asset.options.iconSizes)
      }

      ASTUtils.addChildJSXTag(headNode, iconTag)
    }
  })

  // Create AST representation of the class CustomDocument extends Document
  // https://github.com/zeit/next.js#custom-document
  const fileAST = createDocumentWrapperAST(htmlNode)

  const chunks: Record<string, ChunkDefinition[]> = {
    [FileType.JS]: [
      {
        name: 'document',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: fileAST,
        linkAfter: [],
      },
    ],
  }

  return chunks
}

const createDocumentWrapperAST = (htmlNode: types.JSXElement, t = types) => {
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
