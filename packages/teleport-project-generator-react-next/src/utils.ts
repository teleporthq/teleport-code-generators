import {
  addAttributeToJSXTag,
  addChildJSXTag,
  addChildJSXText,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import { createJSXTag } from '@teleporthq/teleport-shared/lib/builders/ast-builders'

import * as types from '@babel/types'

import { prefixPlaygroundAssetsURL } from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import { EntryFileOptions } from '@teleporthq/teleport-project-generator/lib/types'
import { ProjectUIDL, ChunkDefinition } from '@teleporthq/teleport-types'

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

  if (settings.title) {
    const titleTag = createJSXTag('title')
    addChildJSXText(titleTag, settings.title)
    addChildJSXTag(headNode, titleTag)
  }

  if (manifest) {
    const linkTag = createJSXTag('link')
    addAttributeToJSXTag(linkTag, 'rel', 'manifest')
    addAttributeToJSXTag(linkTag, 'href', '/static/manifest.json')
    addChildJSXTag(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = createJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = prefixPlaygroundAssetsURL(options.assetsPrefix, metaItem[key])
      addAttributeToJSXTag(metaTag, key, metaValue)
    })
    addChildJSXTag(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixPlaygroundAssetsURL(options.assetsPrefix, asset.path)

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
        if (asset.meta && asset.meta.defer) {
          addAttributeToJSXTag(scriptTag, 'defer', true)
        }
        if (asset.meta && asset.meta.async) {
          addAttributeToJSXTag(scriptTag, 'async', true)
        }
      } else if (asset.content) {
        addAttributeToJSXTag(scriptTag, 'dangerouslySetInnerHTML', { __html: asset.content })
      }

      if (asset.meta && asset.meta.target === 'body') {
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

      if (typeof asset.meta === 'object') {
        const assetMeta = asset.meta
        Object.keys(assetMeta).forEach((metaKey) => {
          addAttributeToJSXTag(iconTag, metaKey, assetMeta[metaKey])
        })
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
        type: 'js',
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
