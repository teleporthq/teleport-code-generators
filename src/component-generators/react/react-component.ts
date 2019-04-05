import { AssemblyLine, Builder, Resolver, Validator } from '../../core'

import reactComponentPlugin from '../../plugins/teleport-plugin-react-base-component'
import reactStyledJSXPlugin from '../../plugins/teleport-plugin-react-styled-jsx'
import reactJSSPlugin from '../../plugins/teleport-plugin-react-jss'
import reactInlineStylesPlugin from '../../plugins/teleport-plugin-react-inline-styles'
import reactPropTypesPlugin from '../../plugins/teleport-plugin-react-proptypes'
import reactCSSModulesPlugin from '../../plugins/teleport-plugin-react-css-modules'
import importStatementsPlugin from '../../plugins/teleport-plugin-import-statements'

import { createFile } from '../../shared/utils/project-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import { FILE_TYPE } from '../../shared/constants'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'
import {
  ComponentGenerator,
  GeneratorOptions,
  CompiledComponent,
  GeneratedFile,
} from '../../typings/generators'
import { ComponentUIDL, Mapping } from '../../typings/uidl-definitions'

export enum ReactComponentStylingFlavors {
  InlineStyles = 'InlineStyles',
  StyledJSX = 'StyledJSX',
  JSS = 'JSS',
  CSSModules = 'CSSModules',
}

export interface ReactGeneratorFactoryParams {
  variation?: ReactComponentStylingFlavors
  customMapping?: Mapping
}

const stylePlugins = {
  [ReactComponentStylingFlavors.InlineStyles]: reactInlineStylesPlugin,
  [ReactComponentStylingFlavors.CSSModules]: reactCSSModulesPlugin,
  [ReactComponentStylingFlavors.StyledJSX]: reactStyledJSXPlugin,
  [ReactComponentStylingFlavors.JSS]: reactJSSPlugin,
}

const createReactGenerator = (params: ReactGeneratorFactoryParams = {}): ComponentGenerator => {
  const { variation = ReactComponentStylingFlavors.InlineStyles, customMapping } = params
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

  const generateComponent = async (
    uidl: ComponentUIDL,
    options: GeneratorOptions = {}
  ): Promise<CompiledComponent> => {
    if (!options.skipValidation) {
      const validationResult = validator.validateComponent(uidl)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }
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
