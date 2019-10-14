import { PreactStyleVariation, ComponentGenerator } from '@teleporthq/teleport-types'
import preactComponentPlugin from '@teleporthq/teleport-plugin-preact-base-component'
import { createCSSModulesPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import importPlugin from '@teleporthq/teleport-plugin-import-statements'
import proptypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import PreactMapping from './preact-mapping.json'

const createPreactComponentGenerator = (
  variation = PreactStyleVariation.CSSModules,
  { mappings = [], plugins = [], postprocessors = [] }: GeneratorFactoryParams = {}
): ComponentGenerator => {
  const generator = createComponentGenerator()
  const stylePlugins = {
    [PreactStyleVariation.InlineStyles]: inlineStylesPlugin,
    [PreactStyleVariation.CSSModules]: createCSSModulesPlugin({
      classAttributeName: 'class',
      moduleExtension: false,
      camelCaseClassNames: false,
    }),
    [PreactStyleVariation.CSS]: createCSSPlugin({
      templateChunkName: 'jsx-component',
      templateStyle: 'jsx',
      declareDependency: 'import',
      forceScoping: true,
    }),
  }
  const stylePlugin = stylePlugins[variation]
  if (!stylePlugin) {
    throw new Error(`Invalid style variation '${variation}'`)
  }

  generator.addMapping(PreactMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(preactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(proptypesPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importPlugin)

  generator.addPostProcessor(prettierJS)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createPreactComponentGenerator, PreactMapping, PreactStyleVariation }
