import {
  addAttributeToJSXTag,
  addChildJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { createJSXTag } from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'

import * as types from '@babel/types'

import { prefixAssetsPath } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { ProjectUIDL, ChunkDefinition, EntryFileOptions } from '@teleporthq/teleport-types'

export const createDocumentFileChunks = (uidl: ProjectUIDL, options: EntryFileOptions) => {
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlNode = createJSXTag('html')
  const headNode = createJSXTag('Head')
  const bodyNode = createJSXTag('body')

  const mainNode = createJSXTag('Main')
  const nextScriptNode = createJSXTag('NextScript')
  addChildJSXTag(bodyNode, mainNode)
  addChildJSXTag(bodyNode, nextScriptNode)

  addChildJSXTag(htmlNode, headNode)
  addChildJSXTag(htmlNode, bodyNode)

  if (settings.language) {
    addAttributeToJSXTag(htmlNode, 'lang', settings.language)
  }

  // NOTE: Title is added in per page, not in the layout file

  if (manifest) {
    const linkTag = createJSXTag('link')
    addAttributeToJSXTag(linkTag, 'rel', 'manifest')
    addAttributeToJSXTag(linkTag, 'href', `${options.assetsPrefix}/manifest.json`)
    addChildJSXTag(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = createJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = prefixAssetsPath(options.assetsPrefix, metaItem[key])
      addAttributeToJSXTag(metaTag, key, metaValue)
    })
    addChildJSXTag(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixAssetsPath(options.assetsPrefix, asset.path)

    // link canonical for SEO
    if (asset.type === 'canonical' && assetPath) {
      const linkTag = createJSXTag('link')
      addAttributeToJSXTag(linkTag, 'rel', 'canonical')
      addAttributeToJSXTag(linkTag, 'href', assetPath)
      addChildJSXTag(headNode, linkTag)
    }

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = createJSXTag('link')
      addAttributeToJSXTag(linkTag, 'rel', 'stylesheet')
      addAttributeToJSXTag(linkTag, 'href', assetPath)
      addChildJSXTag(headNode, linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = createJSXTag('style')
      addAttributeToJSXTag(styleTag, 'dangerouslySetInnerHTML', { __html: asset.content })
      addChildJSXTag(headNode, styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptTag = createJSXTag('script')
      addAttributeToJSXTag(scriptTag, 'type', 'text/javascript')
      if (assetPath) {
        addAttributeToJSXTag(scriptTag, 'src', assetPath)
        if (asset.options && asset.options.defer) {
          addAttributeToJSXTag(scriptTag, 'defer', true)
        }
        if (asset.options && asset.options.async) {
          addAttributeToJSXTag(scriptTag, 'async', true)
        }
      } else if (asset.content) {
        addAttributeToJSXTag(scriptTag, 'dangerouslySetInnerHTML', { __html: asset.content })
      }

      if (asset.options && asset.options.target === 'body') {
        addChildJSXTag(bodyNode, scriptTag)
      } else {
        addChildJSXTag(headNode, scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = createJSXTag('link')
      addAttributeToJSXTag(iconTag, 'rel', 'shortcut icon')
      addAttributeToJSXTag(iconTag, 'href', assetPath)

      if (asset.options && asset.options.iconType) {
        addAttributeToJSXTag(iconTag, 'type', asset.options.iconType)
      }
      if (asset.options && asset.options.iconSizes) {
        addAttributeToJSXTag(iconTag, 'sizes', asset.options.iconSizes)
      }

      addChildJSXTag(headNode, iconTag)
    }
  })

  // Create AST representation of the class CustomDocument extends Document
  // https://github.com/zeit/next.js#custom-document
  const fileAST = createDocumentWrapperAST(htmlNode)

  const chunks: Record<string, ChunkDefinition[]> = {
    [FILE_TYPE.JS]: [
      {
        name: 'document',
        type: CHUNK_TYPE.AST,
        fileType: FILE_TYPE.JS,
        content: fileAST,
        linkAfter: [],
      },
    ],
  }

  return chunks
}

const createDocumentWrapperAST = (htmlNode, t = types) => {
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
