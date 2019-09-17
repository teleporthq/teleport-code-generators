import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'
import AssemblyLine from './assembly-line'
import Builder from './builder'
import Resolver from './resolver'

import {
  getComponentFileName,
  getStyleFileName,
  getTemplateFileName,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import {
  ChunkDefinition,
  ComponentGenerator,
  CompiledComponent,
  ComponentPlugin,
  PostProcessor,
  Mapping,
  GeneratorOptions,
} from '@teleporthq/teleport-types'

import HtmlMapping from './html-mapping.json'

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
  const resolver = new Resolver([HtmlMapping as Mapping, ...mappings])
  const assemblyLine = new AssemblyLine(plugins)
  const chunksLinker = new Builder()
  const processors: PostProcessor[] = postprocessors

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

    Object.keys(chunks).forEach((fileType) => {
      codeChunks[fileType] = chunksLinker.link(chunks[fileType])
    })

    processors.forEach((processor) => {
      codeChunks = processor(codeChunks)
    })

    const fileName = getComponentFileName(resolvedUIDL)
    const styleFileName = getStyleFileName(resolvedUIDL)
    const templateFileName = getTemplateFileName(resolvedUIDL)
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

export { createComponentGenerator, HtmlMapping, GeneratorFactoryParams }

export default createComponentGenerator()

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
  if (fileType === FILE_TYPE.CSS) {
    return styleFileName || fileName
  }

  if (fileType === FILE_TYPE.HTML) {
    return templateFileName || fileName
  }

  return fileName
}
