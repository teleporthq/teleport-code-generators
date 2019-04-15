import AssemblyLine from '@teleporthq/teleport-assembly-line'
import Builder from '@teleporthq/teleport-builders'
import Resolver from '@teleporthq/teleport-resolver'
import Validator from '@teleporthq/teleport-validator'

import reactComponentPlugin from '@teleporthq/teleport-react-base-component'
import reactInlineStylesPlugin from '@teleporthq/teleport-react-inline-styles'
import reactPropTypesPlugin from '@teleporthq/teleport-react-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-react-import-statements'

import { createFile } from '@teleporthq/teleport-shared/lib/utils/project-utils'
import { sanitizeVariableName } from '@teleporthq/teleport-shared/lib/utils/string-utils'
import { FILE_TYPE } from '@teleporthq/teleport-constants'

import htmlMapping from '@teleporthq/teleport-uidl-definitions/lib/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'
import { parseComponentJSON } from '@teleporthq/teleport-parser/lib/component'

import {
  ComponentGenerator,
  CompiledComponent,
  GeneratedFile,
  GenerateComponentFunction,
} from '@teleporthq/teleport-types-generator'

import { Mapping } from '@teleporthq/teleport-types-uidl-definitions'

export enum ReactComponentStylingFlavors {
  InlineStyles = 'InlineStyles',
  StyledJSX = 'StyledJSX',
  JSS = 'JSS',
  CSSModules = 'CSSModules',
}

export interface ReactGeneratorFactoryParams {
  variation?: any
  customMapping?: Mapping
}

const createReactGenerator = (params: ReactGeneratorFactoryParams = {}): ComponentGenerator => {
  const { variation, customMapping } = params
  const stylePlugin = variation ? variation.default : reactInlineStylesPlugin
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
    const uidl = parseComponentJSON(input)

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
