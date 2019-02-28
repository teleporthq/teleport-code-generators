import { ChunkDefinition, GeneratorFunction } from '../../shared/types'

import { generator as babelCodeGenerator } from './generators/js-ast-to-code'
import { generator as cheerioHTMLGenerator } from './generators/html-to-string'

export default class Builder {
  public chunkDefinitions: ChunkDefinition[] = []

  public generators: { [key: string]: GeneratorFunction } = {
    js: babelCodeGenerator,
    html: cheerioHTMLGenerator,
    string: (a) => a,
  }

  constructor(chunkDefinitions?: ChunkDefinition[]) {
    if (chunkDefinitions) {
      this.chunkDefinitions = chunkDefinitions
    }
  }

  /**
   * Linnks all chunks togather based on their requirements and returns an array
   * of ordered chunkn names which need to be compiled and glued togather.
   */
  public link(chunkDefinitions?: ChunkDefinition[]): string {
    const chunks = chunkDefinitions || this.chunkDefinitions
    if (!chunks || !chunks.length) {
      return ''
    }

    const dependencies: {
      [key: string]: {
        after: string[]
        children: EmbedDependency[]
        embed: EmbedDependency | null
        chunk: ChunkDefinition | null
      }
    } = {}

    /**
     * Iterate over each chunk and make the helper structure that will be used
     * to better itterate the chunks and reason about them.
     *
     * This structure could be improved, for sure
     */
    chunks.forEach((chunk) => {
      const linker = chunk.linker || {}
      if (!dependencies[chunk.name]) {
        dependencies[chunk.name] = {
          after: [],
          children: [],
          embed: null,
          chunk: null,
        }
      }

      dependencies[chunk.name].chunk = chunk

      if (linker.after) {
        dependencies[chunk.name].after = dependencies[chunk.name].after.concat(linker.after)

        // make a reference for this node dependency, so we can test to see if
        // it is indeed delcared or not
        linker.after.map((key) => {
          if (!dependencies[key]) {
            dependencies[key] = {
              after: [],
              children: [],
              embed: null,
              chunk: null,
            }
          }
        })
      }

      if (linker.embed) {
        if (!dependencies[linker.embed.chunkName]) {
          dependencies[linker.embed.chunkName] = {
            after: [],
            children: [],
            embed: null,
            chunk: null,
          }
        }
        dependencies[linker.embed.chunkName].children.push({
          chunkName: chunk.name,
          slot: linker.embed.slot,
        })
        dependencies[chunk.name].embed = linker.embed
      }
    })

    /**
     * Validate the definitions. If we mispell a chunk name we could end up
     * in a locked state from which we cannot escape.
     */

    Object.keys(dependencies).forEach((key) => {
      if (!dependencies[key].chunk) {
        throw new Error(`chunk with name ${key} was referenced by other chunks but not found.`)
      }
    })

    /**
     * All chunk names at the beginning of the linking. Each time we will link
     * a chunk into the resultinng source string/or file we will remove the key
     * from this keys array. Each time we will emebed one chunnk into another,
     * we will remove the key from this array.
     */
    let keys = Object.keys(dependencies)

    const totalOrder: string[] = []
    let localOrder: string[] = []
    let keyLen = keys.length

    /**
     * Walk thru all the keys (names of chunks). Expect to do some processig on them
     * and their actual chunks so that at some point we no longer keep any key in
     * the array.
     */
    while (keys && keys.length) {
      localOrder = []
      keyLen = keys.length
      /**
       * Take out from the keys the chunks the have no dependency and
       * no children that need to be embeded
       */
      keys = keys.reduce((newKeys: string[], key) => {
        const itDependnecy = dependencies[key]
        if (
          itDependnecy.after.length === 0 &&
          itDependnecy.children.length === 0 &&
          itDependnecy.embed === null
        ) {
          localOrder.push(key)
        } else {
          newKeys.push(key)
        }
        return newKeys
      }, [])

      /**
       * From the remaining keys in the array remove the 'after' condition where
       * after codition is the keys that we recetly removed at this step.
       */
      keys.forEach((key) => {
        const itDependnecy = dependencies[key]
        itDependnecy.after = removeItemsInArray(itDependnecy.after, localOrder)
      })

      /**
       * See if any items ca be embeded
       * A chunk can be embeded if:
       * - it has no children that were not embeded already
       * - it has no after nodes (all after nodes where consumed already either by being
       * extraced into the file code or into a parent chunk)
       */
      const embededChildren: string[] = []
      keys.forEach((key) => {
        const { embed, children, after, chunk } = dependencies[key]
        if (chunk && embed && children.length === 0 && after.length === 0) {
          const parentDefinition = dependencies[embed.chunkName]
          dependencies[embed.chunkName].children = removeChildDependency(
            dependencies[embed.chunkName].children,
            key
          )
          embededChildren.push(key)
          if (
            parentDefinition.chunk &&
            parentDefinition.chunk.linker &&
            parentDefinition.chunk.linker.slots
          ) {
            parentDefinition.chunk.linker.slots[embed.slot]([chunk])
          }
        }
      })

      keys.forEach((key) => {
        const itDependnecy = dependencies[key]
        itDependnecy.after = removeItemsInArray(itDependnecy.after, embededChildren)
      })

      keys = removeItemsInArray(keys, embededChildren)

      totalOrder.push(...localOrder)

      // console.log('step end', keys)
      if (keyLen === keys.length) {
        // tslint:disable-next-line:no-console
        console.error('something went wrog, we did not chage aything in one iteration')
        break
      }
    }

    const resultingString: string[] = []
    totalOrder.map((key) => {
      const chunkToCompile = dependencies[key].chunk
      if (chunkToCompile) {
        const { type, content, wrap } = chunkToCompile
        let compiledContent = this.generateByType(type, content)
        if (wrap) {
          compiledContent = wrap(compiledContent)
        }
        if (compiledContent && compiledContent !== '') {
          resultingString.push(compiledContent)
        }
      }
    })

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
        `Attempted to generate unkown type ${type}. Please register a generator for this type in builder/index.ts`
      )
    }

    return this.generators[type](content)
  }
}

const removeItemsInArray = (arrayToRemoveFrom: string[], itemsToRemove: string[]) => {
  return arrayToRemoveFrom.filter((item: string) => {
    return itemsToRemove.indexOf(item) === -1
  })
}

const removeChildDependency = (children: EmbedDependency[], targetChunkName: string) => {
  return children.reduce((acc: EmbedDependency[], child) => {
    if (child.chunkName !== targetChunkName) {
      acc.push(child)
    }

    return acc
  }, [])
}

interface EmbedDependency {
  chunkName: string
  slot: string
}
