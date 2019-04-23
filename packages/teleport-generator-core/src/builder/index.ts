import { generator as babelCodeGenerator } from '@teleporthq/teleport-generator-shared/lib/generators/js-ast-to-code'
import { generator as htmlGenerator } from '@teleporthq/teleport-generator-shared/lib/generators/html-to-string'
import {
  ChunkDefinition,
  CodeGeneratorFunction,
  ChunkContent,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

export default class Builder {
  private chunkDefinitions: ChunkDefinition[] = []

  private generators: { [key: string]: CodeGeneratorFunction<ChunkContent> } = {
    js: babelCodeGenerator,
    html: htmlGenerator,
    string: (str: string) => str, // no-op for string chunks
  }

  constructor(chunkDefinitions: ChunkDefinition[] = []) {
    this.chunkDefinitions = chunkDefinitions
  }

  /**
   * Links all chunks together based on their requirements. Returns an array
   * of ordered chunk names which need to be compiled and glued together.
   */
  public link(chunkDefinitions: ChunkDefinition[] = []): string {
    const chunks = chunkDefinitions || this.chunkDefinitions
    if (chunks.length <= 0) {
      return ''
    }

    const unprocessedChunks = chunks.map((chunk) => {
      return {
        name: chunk.name,
        type: chunk.type,
        content: chunk.content,
        linkAfter: [...chunk.linkAfter],
      }
    })

    const resultingString: string[] = []

    while (unprocessedChunks.length > 0) {
      let indexToRemove = 0
      for (let index = 0; index < unprocessedChunks.length; index++) {
        if (unprocessedChunks[index].linkAfter.length <= 0) {
          indexToRemove = index
          break
        }
      }

      if (unprocessedChunks[indexToRemove].linkAfter.length > 0) {
        console.info('Operation aborted. Reason: cyclic dependency between chunks.')
        return ''
      }

      const { type, content, name } = unprocessedChunks[indexToRemove]
      const compiledContent = this.generateByType(type, content)
      if (compiledContent) {
        resultingString.push(compiledContent)
      }

      unprocessedChunks.splice(indexToRemove, 1)
      unprocessedChunks.forEach(
        // remove the processed chunk from all the linkAfter arrays from the remaining chunks
        (ch) => (ch.linkAfter = ch.linkAfter.filter((after) => after !== name))
      )
    }

    return resultingString.join('\n')
  }

  public generateByType(type: string, content: any): string {
    if (!content && !content.length) {
      return ''
    }
    if (Array.isArray(content)) {
      return content.map((contentItem) => this.generateByType(type, contentItem)).join('')
    }

    if (!this.generators[type]) {
      throw new Error(
        `Attempted to generate unknown type ${type}. Please register a generator for this type in builder/index.ts`
      )
    }

    return this.generators[type](content)
  }
}
