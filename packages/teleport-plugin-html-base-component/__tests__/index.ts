import { ComponentStructure, FileType } from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { createHTMLBasePlugin } from '../src'

describe('plugin-html-base-component', () => {
  const { htmlComponentPlugin } = createHTMLBasePlugin()

  it('generated HAST nodes with the UIDL that is passed', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      options: {},
      uidl: component('Test', elementNode('container')),
      dependencies: {},
    }

    const { chunks } = await htmlComponentPlugin(structure)
    const htmlChunk = chunks.find((chunk) => chunk.fileType === FileType.HTML)

    expect(chunks.length).toBe(1)
    expect(htmlChunk).toBeDefined()
    expect(htmlChunk.name).toBe('html-template')
  })
})
