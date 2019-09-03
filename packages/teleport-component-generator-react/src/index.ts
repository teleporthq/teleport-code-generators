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

import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import ReactMapping from './react-mapping.json'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

enum ReactStyleVariation {
  InlineStyles = 'Inline Styles',
  CSSModules = 'CSS Modules',
  CSS = 'CSS',
  StyledComponents = 'Styled Components',
  StyledJSX = 'Styled JSX',
  ReactJSS = 'React JSS',
}

const cssPlugin = createCSSPlugin({
  templateChunkName: 'jsx-component',
  templateStyle: 'jsx',
  declareDependency: 'import',
  classAttributeName: 'className',
})

const cssModulesPlugin = createCSSModulesPlugin({ moduleExtension: true })

const stylePlugins = {
  [ReactStyleVariation.InlineStyles]: inlineStylesPlugin,
  [ReactStyleVariation.StyledComponents]: reactStyledComponentsPlugin,
  [ReactStyleVariation.StyledJSX]: reactStyledJSXPlugin,
  [ReactStyleVariation.CSSModules]: cssModulesPlugin,
  [ReactStyleVariation.CSS]: cssPlugin,
  [ReactStyleVariation.ReactJSS]: reactJSSPlugin,
}

const createReactComponentGenerator = (
  variation = ReactStyleVariation.CSSModules,
  { mappings = [], plugins = [], postprocessors = [] }: GeneratorFactoryParams = {}
): ComponentGenerator => {
  const stylePlugin = stylePlugins[variation] || cssPlugin

  const generator = createComponentGenerator()

  generator.addMapping(ReactMapping as Mapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(propTypesPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))

  // Import plugin needs to be last to handle all dependencies
  // TODO: use a different function to set/interact with the import plugin
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createReactComponentGenerator, ReactMapping, ReactStyleVariation }

export default createReactComponentGenerator()
