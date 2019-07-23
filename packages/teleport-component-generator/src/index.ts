import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'
import AssemblyLine from './assembly-line'
import Builder from './builder'
import Resolver from './resolver'

import { getComponentFileName } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import {
  ChunkDefinition,
  ComponentGenerator,
  CompiledComponent,
  ComponentPlugin,
  PostProcessingFunction,
  Mapping,
  GeneratorOptions,
} from '@teleporthq/teleport-types'

import htmlMapping from './html-mapping.json'

export interface GeneratorFactoryParams {
  mappings?: Mapping[]
  plugins?: ComponentPlugin[]
  postprocessors?: PostProcessingFunction[]
}

export const createComponentGenerator = (
  params: GeneratorFactoryParams = { mappings: [], plugins: [], postprocessors: [] }
): ComponentGenerator => {
  const { mappings, plugins, postprocessors } = params

  const validator = new Validator()
  const resolver = new Resolver([htmlMapping as Mapping, ...mappings])
  const assemblyLine = new AssemblyLine(plugins)
  const chunksLinker = new Builder()
  const processors: PostProcessingFunction[] = postprocessors

  const generateComponent = async (
    input: Record<string, unknown>,
    options: GeneratorOptions = {}
  ): Promise<CompiledComponent> => {
    if (!options.skipValidation) {
      const schemaValidationResult = validator.validateComponentSchema(input)
      if (!schemaValidationResult.valid) {
        throw new Error(schemaValidationResult.errorMsg)
      }
    }

    const uidl = Parser.parseComponentJSON(input)

    const contentValidationResult = validator.validateComponentContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    const resolvedUIDL = resolver.resolveUIDL(uidl, options)

    if (assemblyLine.getPlugins().length <= 0) {
      throw new Error('No plugins found. Component generation cannot work without any plugins!')
    }

    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL, options)

    let codeChunks: Record<string, string> = {}

    Object.keys(chunks).forEach((fileId) => {
      codeChunks[fileId] = chunksLinker.link(chunks[fileId])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    const fileName = getComponentFileName(resolvedUIDL)
    const files = fileBundler(fileName, codeChunks)

    return {
      files,
      dependencies: externalDependencies,
    }
  }

  /**
   * Builds each individual chunk and applies the post processors
   * @param chunks All the raw chunks (ASTs, HASTs or JSS/strings)
   * @param fileName The name of the output file
   */
  const linkCodeChunks = (chunks: Record<string, ChunkDefinition[]>, fileName: string) => {
    let codeChunks: Record<string, string> = {}

    Object.keys(chunks).forEach((fileId) => {
      codeChunks[fileId] = chunksLinker.link(chunks[fileId])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    return fileBundler(fileName, codeChunks)
  }

  const addPostProcessor = (fn: PostProcessingFunction) => {
    processors.push(fn)
  }

  return {
    generateComponent,
    linkCodeChunks,
    resolveElement: resolver.resolveElement.bind(resolver),
    addMapping: resolver.addMapping.bind(resolver),
    addPlugin: assemblyLine.addPlugin.bind(assemblyLine),
    addPostProcessor,
  }
}

export default createComponentGenerator()

const fileBundler = (fileName: string, codeChunks: Record<string, string>) => {
  return Object.keys(codeChunks).map((fileId) => {
    return {
      name: fileName,
      fileType: fileId,
      content: codeChunks[fileId],
    }
  })
}
