import { AssemblyLine, Builder, Resolver } from '../../core'

import { createPlugin as reactComponent } from '../../plugins/react/react-base-component'
import { createPlugin as reactStyledJSX } from '../../plugins/react/react-styled-jsx'
import { createPlugin as reactJSS } from '../../plugins/react/react-jss'
import { createPlugin as reactInlineStyles } from '../../plugins/react/react-inline-styles'
import { createPlugin as reactPropTypes } from '../../plugins/react/react-proptypes'
import { createPlugin as reactCSSModules } from '../../plugins/react/react-css-modules'

import { createPlugin as importStatements } from '../../plugins/common/import-statements'

import {
  GeneratorOptions,
  ReactComponentStylingFlavors,
  ComponentGenerator,
  CompiledComponent,
} from '../../shared/types'
import { ComponentUIDL, ElementsMapping } from '../../uidl-definitions/types'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'

import { performance } from 'perf_hooks'

interface ReactGeneratorFactoryParams {
  variation?: ReactComponentStylingFlavors
  customMapping?: ElementsMapping
}

const createReactGenerator = (params: ReactGeneratorFactoryParams = {}): ComponentGenerator => {
  const { variation = ReactComponentStylingFlavors.InlineStyles, customMapping = {} } = params

  const resolver = new Resolver()
  resolver.addMapping(htmlMapping)
  resolver.addMapping(reactMapping)
  resolver.addMapping(customMapping)

  const assemblyLine = new AssemblyLine()
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
    const t0 = performance.now()
    const resolvedUIDL = resolver.resolveUIDL(uidl, generatorOptions)
    const t1 = performance.now()
    console.info(`Resolve time: ${(t1 - t0).toFixed(2)}`)
    const result = await assemblyLine.run(resolvedUIDL)
    const t2 = performance.now()
    console.info(`Assembly time: ${(t2 - t1).toFixed(2)}`)
    const chunksByFileId = assemblyLine.groupChunksByFileId(result.chunks)
    const code = chunksLinker.link(chunksByFileId.default)
    const externalCSS = chunksLinker.link(chunksByFileId['component-styles'])
    const t3 = performance.now()
    console.info(`Link time: ${(t3 - t2).toFixed(2)}`)

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

const chooseStylePlugin = (variation: ReactComponentStylingFlavors) => {
  switch (variation) {
    case ReactComponentStylingFlavors.CSSModules:
      return reactCSSModules({
        componentChunkName: 'react-component',
      })
    case ReactComponentStylingFlavors.InlineStyles:
      return reactInlineStyles({
        componentChunkName: 'react-component',
      })
    case ReactComponentStylingFlavors.JSS:
      return reactJSS({
        componentChunkName: 'react-component',
        importChunkName: 'import',
        exportChunkName: 'export',
      })
    case ReactComponentStylingFlavors.StyledJSX:
      return reactStyledJSX({
        componentChunkName: 'react-component',
      })
    default:
      return reactInlineStyles({
        componentChunkName: 'react-component',
      })
  }
}

export default createReactGenerator
