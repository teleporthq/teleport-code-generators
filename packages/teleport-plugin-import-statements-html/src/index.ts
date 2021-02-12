import {
  ComponentPlugin,
  FileType,
  ChunkType,
  HTMLComponentGeneratorError,
  HastNode,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'

export const createHTMLImportStatementsPlugin = () => {
  const htmlImportsPlugin: ComponentPlugin = async (structure) => {
    const { dependencies = {}, chunks } = structure
    let chunkIndex = 0
    const htmlChunk = chunks.find((chunk, index) => {
      if (
        chunk.name === 'html-template' &&
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

    if (Object.keys(dependencies).length === 0) {
      return structure
    }

    const headTag = HASTBuilders.createHTMLNode('head')
    Object.keys(dependencies).forEach((item) => {
      const dependency = dependencies[item]
      if (dependency.meta?.importJustPath) {
        if (dependency.path.endsWith('css')) {
          const linkTag = HASTBuilders.createHTMLNode('link')
          HASTUtils.addAttributeToNode(linkTag, 'href', dependency.path)
          HASTUtils.addAttributeToNode(linkTag, 'rel', 'stylesheet')
          HASTUtils.addChildNode(headTag, linkTag)
        } else {
          const scriptTag = HASTBuilders.createHTMLNode('script')
          HASTUtils.addAttributeToNode(scriptTag, 'type', 'text/javascript')
          HASTUtils.addAttributeToNode(scriptTag, 'src', dependency.path)
        }
      }
    })
    htmlTag.children = [headTag, ...htmlTag.children]

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
