import {
  addAttributeToJSXTag,
  addChildJSXTag,
  addChildJSXText,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import { generateASTDefinitionForJSXTag } from '@teleporthq/teleport-shared/lib/builders/ast-builders'

import * as types from '@babel/types'

import { prefixPlaygroundAssetsURL } from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { EntryFileOptions } from '@teleporthq/teleport-project-generator/lib/types'
import { ProjectUIDL } from '@teleporthq/teleport-types'

export const createDocumentComponentAST = (uidl: ProjectUIDL, options: EntryFileOptions) => {
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
      const metaValue = prefixPlaygroundAssetsURL(options.assetsPrefix, metaItem[key])
      addAttributeToJSXTag(metaTag, { name: key, value: metaValue })
    })
    addChildJSXTag(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixPlaygroundAssetsURL(options.assetsPrefix, asset.path)

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
  return createDocumentWrapperAST(htmlNode)
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
