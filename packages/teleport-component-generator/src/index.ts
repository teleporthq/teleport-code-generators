import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'
import { Resolver, HTMLMapping } from '@teleporthq/teleport-uidl-resolver'
import AssemblyLine from './assembly-line'
import Builder from './builder'

import { UIDLUtils } from '@teleporthq/teleport-shared'

import {
  ChunkDefinition,
  ComponentGenerator,
  CompiledComponent,
  ComponentPlugin,
  PostProcessor,
  Mapping,
  FileType,
  GeneratorOptions,
} from '@teleporthq/teleport-types'

interface GeneratorFactoryParams {
  mappings?: Mapping[]
  plugins?: ComponentPlugin[]
  postprocessors?: PostProcessor[]
}

const createComponentGenerator = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const validator = new Validator()
  const resolver = new Resolver([HTMLMapping as Mapping, ...mappings])
  const assemblyLine = new AssemblyLine(plugins)
  const chunksLinker = new Builder()
  const processors: PostProcessor[] = postprocessors

  const generateComponent = async (
    input: Record<string, unknown>,
    options: GeneratorOptions = {}
  ): Promise<CompiledComponent> => {
    let cleanedUIDL = input
    if (!options.skipValidation) {
      const schemaValidator = options?.isRootComponent
        ? validator.validateRootComponentSchema
        : validator.validateComponentSchema

      const schemaValidationResult = schemaValidator(input)
      const { componentUIDL, valid } = schemaValidationResult
      if (valid && componentUIDL) {
        cleanedUIDL = (componentUIDL as unknown) as Record<string, unknown>
      } else {
        throw new Error(schemaValidationResult.errorMsg)
      }
    }
    const uidl = Parser.parseComponentJSON(cleanedUIDL)

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

    Object.keys(chunks).forEach((fileType) => {
      codeChunks[fileType] = chunksLinker.link(chunks[fileType])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    const fileName = UIDLUtils.getComponentFileName(resolvedUIDL)
    const styleFileName = UIDLUtils.getStyleFileName(resolvedUIDL)
    const templateFileName = UIDLUtils.getTemplateFileName(resolvedUIDL)
    const files = fileBundler(codeChunks, fileName, styleFileName, templateFileName)

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

    Object.keys(chunks).forEach((fileType) => {
      codeChunks[fileType] = chunksLinker.link(chunks[fileType])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    return fileBundler(codeChunks, fileName)
  }

  const addPostProcessor = (fn: PostProcessor) => {
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

export { createComponentGenerator, GeneratorFactoryParams }

const fileBundler = (
  codeChunks: Record<string, string>,
  fileName: string,
  styleFileName?: string,
  templateFileName?: string
) => {
  return Object.keys(codeChunks).map((fileType) => {
    return {
      name: getFileName(fileType, fileName, styleFileName, templateFileName),
      fileType,
      content: codeChunks[fileType],
    }
  })
}

// Based on the file type we selected the file name associated.
// This is mostly used by project generators when a component is exported in its own folder
const getFileName = (
  fileType: string,
  fileName: string,
  styleFileName: string,
  templateFileName: string
) => {
  if (fileType === FileType.CSS) {
    return styleFileName || fileName
  }

  if (fileType === FileType.HTML) {
    return templateFileName || fileName
  }

  return fileName
}
