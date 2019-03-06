import { AssemblyLine, Builder, Resolver } from '../../core'

import reactComponentPlugin from '../../plugins/react/react-base-component'
import reactStyledJSXPlugin from '../../plugins/react/react-styled-jsx'
import reactJSSPlugin from '../../plugins/react/react-jss'
import reactInlineStylesPlugin from '../../plugins/react/react-inline-styles'
import reactPropTypesPlugin from '../../plugins/react/react-proptypes'
import reactCSSModulesPlugin from '../../plugins/react/react-css-modules'
import importStatementsPlugin from '../../plugins/common/import-statements'

import {
  GeneratorOptions,
  ReactComponentStylingFlavors,
  ComponentGenerator,
  CompiledComponent,
} from '../../shared/types'
import { ComponentUIDL, ElementsMapping } from '../../uidl-definitions/types'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'

interface ReactGeneratorFactoryParams {
  variation?: ReactComponentStylingFlavors
  customMapping?: ElementsMapping
}

const stylePlugins = {
  [ReactComponentStylingFlavors.InlineStyles]: reactInlineStylesPlugin,
  [ReactComponentStylingFlavors.CSSModules]: reactCSSModulesPlugin,
  [ReactComponentStylingFlavors.StyledJSX]: reactStyledJSXPlugin,
  [ReactComponentStylingFlavors.JSS]: reactJSSPlugin,
}

const createReactGenerator = (params: ReactGeneratorFactoryParams = {}): ComponentGenerator => {
  const { variation = ReactComponentStylingFlavors.InlineStyles, customMapping = {} } = params
  const stylePlugin = stylePlugins[variation] || reactInlineStylesPlugin

  const resolver = new Resolver()
  resolver.addMapping(htmlMapping)
  resolver.addMapping(reactMapping)
  resolver.addMapping(customMapping)

  const assemblyLine = new AssemblyLine()
  assemblyLine.addPlugin(reactComponentPlugin)
  assemblyLine.addPlugin(stylePlugin)
  assemblyLine.addPlugin(reactPropTypesPlugin)
  assemblyLine.addPlugin(importStatementsPlugin)

  const chunksLinker = new Builder()

  const generateComponent = async (
    uidl: ComponentUIDL,
    generatorOptions: GeneratorOptions = {}
  ): Promise<CompiledComponent> => {
    const resolvedUIDL = resolver.resolveUIDL(uidl, generatorOptions)
    const result = await assemblyLine.run(resolvedUIDL)

    const chunksByFileId = assemblyLine.groupChunksByFileId(result.chunks)
    const code = chunksLinker.link(chunksByFileId.default)
    const externalCSS = chunksLinker.link(chunksByFileId['component-styles'])

    return {
      dependencies: result.dependencies,
      code,
      externalCSS,
    }
  }

  return {
    generateComponent,
    resolveContentNode: resolver.resolveContentNode.bind(resolver),
    addMapping: resolver.addMapping.bind(resolver),
    addPlugin: assemblyLine.addPlugin.bind(assemblyLine),
  }
}

export default createReactGenerator
