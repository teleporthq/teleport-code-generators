import preactComponentPlugin from '@teleporthq/teleport-plugin-preact-base-component'
import { createPlugin as createCSSModulesPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createPlugin as createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import proptypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import PreactMapping from './preact-mapping.json'

import { ComponentGenerator } from '@teleporthq/teleport-types'

enum PreactStyleVariation {
  InlineStyles = 'Inline Styles',
  CSSModules = 'CSS Modules',
  CSS = 'CSS',
}

const cssPlugin = createCSSPlugin({
  templateChunkName: 'jsx-component',
  templateStyle: 'jsx',
  declareDependency: 'import',
})

const cssModulesPlugin = createCSSModulesPlugin({
  classAttributeName: 'class',
  moduleExtension: false,
})

const stylePlugins = {
  [PreactStyleVariation.InlineStyles]: inlineStylesPlugin,
  [PreactStyleVariation.CSSModules]: cssModulesPlugin,
  [PreactStyleVariation.CSS]: cssPlugin,
}

const createPreactComponentGenerator = (
  variation = PreactStyleVariation.CSSModules,
  { mappings = [], plugins = [], postprocessors = [] }: GeneratorFactoryParams = {}
): ComponentGenerator => {
  const generator = createComponentGenerator()
  const stylePlugin = stylePlugins[variation] || cssPlugin

  generator.addMapping(PreactMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(preactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(proptypesPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createPreactComponentGenerator, PreactMapping, PreactStyleVariation }

export default createPreactComponentGenerator()
