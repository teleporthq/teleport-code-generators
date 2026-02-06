import {
  ComponentPlugin,
  FileType,
  ChunkType,
  HTMLComponentGeneratorError,
  HastNode,
  GeneratorOptions,
  UIDLElementNode,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'

const getTranslation = (
  id: string,
  options: GeneratorOptions
): UIDLElementNode | UIDLStaticValue | null => {
  const i18n = options.internationalization
  if (!i18n?.translations) {
    return null
  }
  const locale = i18n.targetLocale || i18n.main?.locale
  if (!locale) {
    return null
  }
  return i18n.translations[locale]?.[id] || null
}

const resolveTranslationText = (translation: UIDLElementNode | UIDLStaticValue): string => {
  if (translation.type === 'static') {
    return String(translation.content)
  }
  if (translation.type === 'element' && translation.content.children) {
    return translation.content.children
      .map((child) => {
        if (child.type === 'static') {
          return String(child.content)
        }
        if (child.type === 'element') {
          return resolveTranslationText(child)
        }
        return ''
      })
      .join('')
  }
  return ''
}

export const createHTMLImportStatementsPlugin = () => {
  const htmlImportsPlugin: ComponentPlugin = async (structure) => {
    const { dependencies = {}, chunks, uidl } = structure
    let chunkIndex = 0
    const htmlChunk = chunks.find((chunk, index) => {
      if (
        chunk.name === 'html-chunk' &&
        chunk.type === ChunkType.HAST &&
        chunk.fileType === FileType.HTML
      ) {
        chunkIndex = index
        return chunk
      }
    })
    if (!htmlChunk) {
      throw new HTMLComponentGeneratorError(
        `HTML Chunk is missing from the generated chunks from htmlImportsPlugin`
      )
    }
    const htmlTag = htmlChunk.content as HastNode
    const tags: HastNode[] = []

    if (Object.keys(dependencies).length === 0) {
      return structure
    }

    Object.keys(dependencies).forEach((item) => {
      const dependency = dependencies[item]
      const {
        meta: { importJustPath, importAlias },
        path,
      } = dependency
      if (importJustPath) {
        if (importAlias?.endsWith('css') || path.endsWith('css')) {
          const linkTag = HASTBuilders.createHTMLNode('link')
          HASTUtils.addAttributeToNode(linkTag, 'href', importAlias ?? path)
          HASTUtils.addAttributeToNode(linkTag, 'rel', 'stylesheet')
          tags.push(linkTag)
        } else {
          const scriptTag = HASTBuilders.createHTMLNode('script')
          HASTUtils.addAttributeToNode(scriptTag, 'type', 'text/javascript')
          HASTUtils.addAttributeToNode(scriptTag, 'src', importAlias ?? path)
          tags.push(scriptTag)
        }
      }
    })

    if (uidl?.seo) {
      const { metaTags = [], assets, title } = uidl.seo
      if (title) {
        const titleTag = HASTBuilders.createHTMLNode('title')
        let titleText: string | null = null

        if (typeof title === 'string') {
          titleText = title
        } else if (title.type === 'static') {
          titleText = title.content.toString()
        } else if (title.type === 'dynamic' && title.content.referenceType === 'locale') {
          const translation = getTranslation(title.content.id, structure.options)
          if (translation) {
            titleText = resolveTranslationText(translation)
          }
        }

        if (titleText) {
          HASTUtils.addTextNode(titleTag, StringUtils.encode(titleText))
          tags.push(titleTag)
        }
      }

      if (metaTags.length > 0) {
        metaTags.forEach((meta) => {
          const metaTag = HASTBuilders.createHTMLNode('meta')
          let hasUnresolvableValue = false
          Object.keys(meta).forEach((key) => {
            const value = meta[key]
            if (typeof value === 'string') {
              HASTUtils.addAttributeToNode(metaTag, key, value)
              return
            }
            if (
              typeof value === 'object' &&
              value.type === 'dynamic' &&
              value.content?.referenceType === 'locale'
            ) {
              const translation = getTranslation(value.content.id, structure.options)
              if (translation) {
                HASTUtils.addAttributeToNode(metaTag, key, resolveTranslationText(translation))
                return
              }
            }
            hasUnresolvableValue = true
          })
          if (!hasUnresolvableValue) {
            tags.push(metaTag)
          }
        })
      }

      if (assets && assets.length > 0) {
        assets.forEach((asset) => {
          if (asset.type === 'canonical' && asset.path) {
            const linkTag = HASTBuilders.createHTMLNode('link')
            HASTUtils.addAttributeToNode(linkTag, 'rel', 'canonical')
            HASTUtils.addAttributeToNode(linkTag, 'href', asset.path)
            HASTUtils.addChildNode(htmlTag, linkTag)
          }
        })
      }
    }

    htmlTag.children = [...tags, ...htmlTag.children]

    chunks.splice(chunkIndex, 1)
    chunks.push({
      ...htmlChunk,
      content: htmlTag,
    })

    return structure
  }

  return htmlImportsPlugin
}

export default createHTMLImportStatementsPlugin()
