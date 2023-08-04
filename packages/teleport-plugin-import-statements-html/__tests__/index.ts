import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { ChunkType, ComponentStructure, FileType, HastNode } from '@teleporthq/teleport-types'
import { createHTMLImportStatementsPlugin } from '../src'

describe('Plugin html import statements', () => {
  const structure: ComponentStructure = {
    chunks: [
      {
        type: ChunkType.HAST,
        fileType: FileType.HTML,
        name: 'html-chunk',
        content: {
          type: 'element',
          tagName: 'div',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'container',
              properties: {},
              children: [],
            },
          ],
        },
        linkAfter: [],
        meta: {
          nodesLookup: {
            container: {
              type: 'element',
              tagName: 'container',
              properties: {},
              children: [],
            },
          },
        },
      },
    ],
    options: {},
    uidl: component('Test', elementNode('container')),
    dependencies: {
      './sampl.css': { type: 'local', path: './sample.css', meta: { importJustPath: true } },
    },
  }
  const plugin = createHTMLImportStatementsPlugin()
  it('generate import chunks for from dependencies', async () => {
    const result = await plugin(structure)
    const htmlChunk = result.chunks.find((chunk) => chunk.fileType === FileType.HTML)

    expect((htmlChunk.content as HastNode).children.length).toBe(2)
  })
})
