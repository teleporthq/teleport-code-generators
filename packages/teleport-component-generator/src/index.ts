import {
  AssemblyLine,
  Builder,
  Resolver,
  Validator,
  Parser,
} from '@teleporthq/teleport-generator-core'

import { createFile } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { camelCaseToDashCase } from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'

import {
  ChunkDefinition,
  ComponentGenerator,
  CompiledComponent,
  GenerateComponentFunction,
  ComponentPlugin,
  PostProcessingFunction,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

import htmlMapping from './html-mapping.json'

export interface GeneratorFactoryParams {
  mappings?: Mapping[]
  plugins?: ComponentPlugin[]
  postprocessors?: PostProcessingFunction[]
}

export const createGenerator = (
  params: GeneratorFactoryParams = { mappings: [], plugins: [], postprocessors: [] }
): ComponentGenerator => {
  const { mappings, plugins, postprocessors } = params

  const validator = new Validator()
  const resolver = new Resolver([htmlMapping as Mapping, ...mappings])
  const assemblyLine = new AssemblyLine(plugins)
  const chunksLinker = new Builder()
  const processors: PostProcessingFunction[] = postprocessors

  const generateComponent: GenerateComponentFunction = async (
    input,
    options = {}
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

    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)

    let codeChunks: Record<string, string> = {}

    Object.keys(chunks).forEach((fileId) => {
      codeChunks[fileId] = chunksLinker.link(chunks[fileId])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    const fileName = uidl.meta && uidl.meta.fileName ? uidl.meta.fileName : uidl.name
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

export default createGenerator()

const fileBundler = (fileName: string, codeChunks: Record<string, string>) => {
  const cleanFileName = camelCaseToDashCase(fileName)

  return Object.keys(codeChunks).map((fileId) => {
    return createFile(cleanFileName, fileId, codeChunks[fileId])
  })
}
