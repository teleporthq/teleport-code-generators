import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import reactJSSPlugin from '@teleporthq/teleport-plugin-react-jss'
import { createPlugin as createCSSModulesPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createPlugin as createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import reactStyledComponentsPlugin from '@teleporthq/teleport-plugin-react-styled-components'
import reactStyledJSXPlugin from '@teleporthq/teleport-plugin-react-styled-jsx'
import propTypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactMapping from './react-mapping.json'

import { ComponentGenerator, Mapping, ComponentPlugin } from '@teleporthq/teleport-types'

const cssPlugin = createCSSPlugin({
  templateChunkName: 'jsx-component',
  templateStyle: 'jsx',
  declareDependency: 'import',
  classAttributeName: 'className',
})

const cssModulesPlugin = createCSSModulesPlugin({ moduleExtension: true })

const stylePlugins = {
  InlineStyles: inlineStylesPlugin,
  StyledComponents: reactStyledComponentsPlugin,
  StyledJSX: reactStyledJSXPlugin,
  CSSModules: cssModulesPlugin,
  CSS: cssPlugin,
  JSS: reactJSSPlugin,
}

export const createReactComponentGenerator = (
  variation: string = 'CSS',
  plugins: ComponentPlugin[] = [],
  mapping: Mapping = {}
): ComponentGenerator => {
  const stylePlugin = stylePlugins[variation] || cssPlugin

  const generator = createComponentGenerator()

  generator.addMapping(reactMapping as Mapping)
  generator.addMapping(mapping)

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(propTypesPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))

  // Import plugin needs to be last to handle all dependencies
  // TODO: use a different function to set/interact with the import plugin
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createReactComponentGenerator()
