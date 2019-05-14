import {
  AssemblyLine,
  Builder,
  Resolver,
  Validator,
  Parser,
} from '@teleporthq/teleport-generator-core'

import { createFile } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { sanitizeVariableName } from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'

import {
  ComponentGenerator,
  CompiledComponent,
  GenerateComponentFunction,
  ComponentPlugin,
  PostProcessingFunction,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { Mapping, ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

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
      const validationResult = validator.validateComponent(input)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }

    const uidl = Parser.parseComponentJSON(input)

    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)

    let codeChunks: Record<string, string> = {}

    Object.keys(chunks).forEach((fileId) => {
      codeChunks[fileId] = chunksLinker.link(chunks[fileId])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    const files = fileBundler(uidl, codeChunks)

    return {
      files,
      dependencies: externalDependencies,
    }
  }

  const addPostProcessor = (fn: PostProcessingFunction) => {
    processors.push(fn)
  }

  return {
    generateComponent,
    resolveElement: resolver.resolveElement.bind(resolver),
    addMapping: resolver.addMapping.bind(resolver),
    addPlugin: assemblyLine.addPlugin.bind(assemblyLine),
    addPostProcessor,
  }
}

export default createGenerator()

const fileBundler = (uidl: ComponentUIDL, codeChunks: any) => {
  let fileName = uidl.meta && uidl.meta.fileName ? uidl.meta.fileName : uidl.name
  fileName = sanitizeVariableName(fileName)

  return Object.keys(codeChunks).map((fileId) => {
    return createFile(fileName, fileId, codeChunks[fileId])
  })
}
