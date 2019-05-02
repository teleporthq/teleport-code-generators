import {
  AssemblyLine,
  Builder,
  Resolver,
  Validator,
  Parser,
} from '@teleporthq/teleport-generator-core'

import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import reactInlineStylesPlugin from '@teleporthq/teleport-plugin-react-inline-styles'
import reactStyledJSXPlugin from '@teleporthq/teleport-plugin-react-styled-jsx'
import reactPropTypesPlugin from '@teleporthq/teleport-plugin-react-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import { createFile } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { sanitizeVariableName } from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'
import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'

import htmlMapping from './html-mapping.json'
import reactMapping from './react-mapping.json'

import {
  ComponentGenerator,
  CompiledComponent,
  GeneratedFile,
  GenerateComponentFunction,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const stylePlugins = {
  InlineStyles: reactInlineStylesPlugin,
  StyledJSX: reactStyledJSXPlugin,
}

export interface ReactGeneratorFactoryParams {
  variation?: string
  customMapping?: Mapping
}

const createReactGenerator = (params: ReactGeneratorFactoryParams = {}): ComponentGenerator => {
  const { variation, customMapping } = params
  const stylePlugin = stylePlugins[variation] || reactInlineStylesPlugin
  const validator = new Validator()

  const resolver = new Resolver()
  resolver.addMapping(htmlMapping as Mapping)
  resolver.addMapping(reactMapping as Mapping)
  resolver.addMapping(customMapping)

  const assemblyLine = new AssemblyLine()
  assemblyLine.addPlugin(reactComponentPlugin)
  assemblyLine.addPlugin(stylePlugin)
  assemblyLine.addPlugin(reactPropTypesPlugin)
  assemblyLine.addPlugin(importStatementsPlugin)

  const chunksLinker = new Builder()

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

    const files: GeneratedFile[] = []
    // For page components, for some frameworks the filename will be the one set in the meta property
    let fileName = uidl.meta && uidl.meta.fileName ? uidl.meta.fileName : uidl.name
    fileName = sanitizeVariableName(fileName)

    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)

    const jsCode = chunksLinker.link(chunks.default)
    const cssCode = chunksLinker.link(chunks.cssmodule)

    files.push(createFile(fileName, FILE_TYPE.JS, jsCode))

    if (cssCode) {
      files.push(createFile(fileName, FILE_TYPE.CSS, cssCode))
    }

    return {
      files,
      dependencies: externalDependencies,
    }
  }

  return {
    generateComponent,
    resolveElement: resolver.resolveElement.bind(resolver),
    addMapping: resolver.addMapping.bind(resolver),
    addPlugin: assemblyLine.addPlugin.bind(assemblyLine),
  }
}

export default createReactGenerator
