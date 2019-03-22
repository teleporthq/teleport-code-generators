import { generator } from '../../core/builder/generators/html-to-string'
import {
  createHTMLNode,
  addAttributeToNode,
  addChildNode,
  addTextNode,
  addBooleanAttributeToNode,
} from '../../shared/utils/html-utils'
import { ProjectUIDL } from '../../uidl-definitions/types'
import { ASSETS_PREFIX } from './constants'
import { prefixPlaygroundAssetsURL } from '../../shared/utils/uidl-utils'

export const createHtmlIndexFile = (uidl: ProjectUIDL) => {
  const { settings, meta, assets, manifest } = uidl.globals

  const htmlNode = createHTMLNode('html')
  const headNode = createHTMLNode('head')
  const bodyNode = createHTMLNode('body')
  const reactRootNode = createHTMLNode('div')
  addAttributeToNode(reactRootNode, 'id', 'root')

  addChildNode(htmlNode, headNode)
  addChildNode(htmlNode, bodyNode)
  addChildNode(bodyNode, reactRootNode)

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
      const prefixedURL = prefixPlaygroundAssetsURL(ASSETS_PREFIX, metaItem[key])
      addAttributeToNode(metaTag, key, prefixedURL)
    })
    addChildNode(headNode, metaTag)
  })

  assets.forEach((asset) => {
    const assetPath = prefixPlaygroundAssetsURL(ASSETS_PREFIX, asset.path)

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
