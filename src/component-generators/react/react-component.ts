import { ComponentAssemblyLine, Builder, Resolver } from '../pipeline'

import { createPlugin as reactComponent } from '../plugins/react/react-base-component'
import { createPlugin as reactStyledJSX } from '../plugins/react/react-styled-jsx'
import { createPlugin as reactJSS } from '../plugins/react/react-jss'
import { createPlugin as reactInlineStyles } from '../plugins/react/react-inline-styles'
import { createPlugin as reactPropTypes } from '../plugins/react/react-proptypes'
import { createPlugin as reactCSSModules } from '../plugins/react/react-css-modules'

import { createPlugin as importStatements } from '../plugins/common/import-statements'

import {
  GeneratorOptions,
  ReactComponentFlavors,
  ComponentGenerator,
  CompiledComponent,
} from '../types'
import { ComponentUIDL, ElementsMapping } from '../../uidl-definitions/types'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './elements-mapping.json'
import { groupChunksByFileId } from './utils'

interface ReactGeneratorFactoryParams {
  variation?: ReactComponentFlavors
  customMapping?: ElementsMapping
}

const chooseStylePlugin = (variation: ReactComponentFlavors) => {
  switch (variation) {
    case ReactComponentFlavors.CSSModules:
      return reactCSSModules({
        componentChunkName: 'react-component',
      })
    case ReactComponentFlavors.InlineStyles:
      return reactInlineStyles({
        componentChunkName: 'react-component',
      })
    case ReactComponentFlavors.JSS:
      return reactJSS({
        componentChunkName: 'react-component',
        importChunkName: 'import',
        exportChunkName: 'export',
      })
    case ReactComponentFlavors.StyledJSX:
      return reactStyledJSX({
        componentChunkName: 'react-component',
      })
  }
}

const createReactGenerator = (params: ReactGeneratorFactoryParams = {}): ComponentGenerator => {
  const { variation = ReactComponentFlavors.CSSModules, customMapping = {} } = params

  const resolver = new Resolver()
  resolver.addMapping(htmlMapping)
  resolver.addMapping(reactMapping)
  resolver.addMapping(customMapping)

  const assemblyLine = new ComponentAssemblyLine()
  assemblyLine.addPlugin(
    reactComponent({
      componentChunkName: 'react-component',
      importChunkName: 'import',
      exportChunkName: 'export',
    })
  )
  assemblyLine.addPlugin(chooseStylePlugin(variation))
  assemblyLine.addPlugin(
    reactPropTypes({
      componentChunkName: 'react-component',
    })
  )
  assemblyLine.addPlugin(
    importStatements({
      importLibsChunkName: 'import',
    })
  )

  const chunksLinker = new Builder()

  const generateComponent = async (
    uidl: ComponentUIDL,
    generatorOptions: GeneratorOptions = {}
  ): Promise<CompiledComponent> => {
    const resolvedUIDL = resolver.resolveUIDL(uidl, generatorOptions)
    const result = await assemblyLine.run(resolvedUIDL)

    const chunksByFileId = groupChunksByFileId(result.chunks)

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
    resolveContentNode: resolver.resolveContentNode,
    addMapping: resolver.addMapping,
    addPlugin: assemblyLine.addPlugin,
  }
}

export default createReactGenerator
