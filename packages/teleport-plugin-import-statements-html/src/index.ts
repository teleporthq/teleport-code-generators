import {
  ComponentPlugin,
  FileType,
  ChunkType,
  HTMLComponentGeneratorError,
  HastNode,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'

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
        if (typeof title !== 'string') {
          throw new Error('Unsupporder HTML title type. Only string is supported.')
        }

        HASTUtils.addTextNode(titleTag, StringUtils.encode(title))
        tags.push(titleTag)
      }

      if (metaTags.length > 0) {
        metaTags.forEach((meta) => {
          const metaTag = HASTBuilders.createHTMLNode('meta')
          Object.keys(meta).forEach((key) => {
            const value = meta[key]
            if (typeof value !== 'string') {
              throw new Error('Unsupporder HTML meta type. Only string is supported.')
            }

            HASTUtils.addAttributeToNode(metaTag, key, value)
          })
          tags.push(metaTag)
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
