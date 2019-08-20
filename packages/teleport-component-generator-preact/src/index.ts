import preactComponentPlugin from '@teleporthq/teleport-plugin-preact-base-component'
import { createPlugin as createCSSModulesPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createPlugin as createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import proptypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import preactMapping from './preact-mapping.json'

import { ComponentGenerator, Mapping, ComponentPlugin } from '@teleporthq/teleport-types'

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
  InlineStyles: inlineStylesPlugin,
  CSSModules: cssModulesPlugin,
  CSS: cssPlugin,
}

export const createPreactComponentGenerator = (
  variation: string = 'CSSModules',
  plugins: ComponentPlugin[] = [],
  mapping: Mapping = {}
): ComponentGenerator => {
  const generator = createComponentGenerator()
  const stylePlugin = stylePlugins[variation] || cssPlugin

  generator.addMapping(preactMapping)
  generator.addMapping(mapping)

  generator.addPlugin(preactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(proptypesPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createPreactComponentGenerator()
