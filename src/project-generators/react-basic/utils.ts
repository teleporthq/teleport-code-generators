import { generator } from '../../core/builder/generators/html-to-string'
import { createXMLNode, createXMLRoot } from '../../shared/utils/xml-utils'
import { ProjectUIDL } from '../../uidl-definitions/types'
import { ASSETS_PREFIX } from './constants'
import { prefixPlaygroundAssetsURL } from '../../shared/utils/uidl-utils'

export const createHtmlIndexFile = (uidl: ProjectUIDL) => {
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlRoot = createXMLRoot('html')
  const htmlNode = htmlRoot('html')
  const headNode = createXMLNode('head')
  const bodyNode = createXMLNode('body')
  const reactRootNode = createXMLNode('div')
  reactRootNode.attr('id', 'root')

  htmlNode.append(headNode)
  htmlNode.append(bodyNode)
  bodyNode.append(reactRootNode)

  if (settings.language) {
    htmlNode.attr('lang', settings.language)
  }

  if (settings.title) {
    const titleTag = createXMLNode('title')
    titleTag.append(settings.title)
    headNode.append(titleTag)
  }

  if (manifest) {
    const linkTag = createXMLNode('link', { selfClosing: true })
    linkTag.attr('rel', 'manifest')
    linkTag.attr('href', '/static/manifest.json')
    headNode.append(linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = createXMLNode('meta', { selfClosing: true })
    Object.keys(metaItem).forEach((key) => {
      const prefixedURL = prefixPlaygroundAssetsURL(ASSETS_PREFIX, metaItem[key])
      metaTag.attr(key, prefixedURL)
    })
    headNode.append(metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixPlaygroundAssetsURL(ASSETS_PREFIX, asset.path)

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = createXMLNode('link', { selfClosing: true })
      linkTag.attr('rel', 'stylesheet')
      linkTag.attr('href', assetPath)
      headNode.append(linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = createXMLNode('style')
      styleTag.append(asset.content)
      headNode.append(styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptInBody = (asset.meta && asset.meta.target === 'body') || false
      const scriptTag = createXMLNode('script')
      scriptTag.append(' ') // To ensure tag is not automatically self-closing, which causes problems in the <head>
      scriptTag.attr('type', 'text/javascript')
      if (assetPath) {
        scriptTag.attr('src', assetPath)
        if (asset.meta && asset.meta.defer) {
          scriptTag.attr('defer', true)
        }
        if (asset.meta && asset.meta.async) {
          scriptTag.attr('async', true)
        }
      } else if (asset.content) {
        scriptTag.append(asset.content)
      }
      if (scriptInBody) {
        bodyNode.append(scriptTag)
      } else {
        headNode.append(scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = createXMLNode('link', { selfClosing: true })
      iconTag.attr('rel', 'shortcut icon')
      iconTag.attr('href', assetPath)
      if (typeof asset.meta === 'object') {
        const assetMeta = asset.meta
        Object.keys(assetMeta).forEach((metaKey) => {
          iconTag.attr(metaKey, assetMeta[metaKey])
        })
      }
      headNode.append(iconTag)
    }
  })

  const htmlInnerString = generator(htmlRoot)
  return `
<!DOCTYPE html>
${htmlInnerString}`
}
