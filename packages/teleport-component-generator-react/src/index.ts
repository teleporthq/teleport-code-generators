import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import reactJSSPlugin from '@teleporthq/teleport-plugin-react-jss'
import { createCSSModulesPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import reactStyledComponentsPlugin from '@teleporthq/teleport-plugin-react-styled-components'
import reactStyledJSXPlugin from '@teleporthq/teleport-plugin-react-styled-jsx'
import propTypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'
import {
  ComponentGenerator,
  ReactStyleVariation,
  ComponentGeneratorInstance,
} from '@teleporthq/teleport-types'
import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import { ReactMapping } from './react-mapping'

const createReactComponentGenerator: ComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
  variation = ReactStyleVariation.CSSModules,
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const cssPlugin = createCSSPlugin({
    templateChunkName: 'jsx-component',
    templateStyle: 'jsx',
    declareDependency: 'import',
    classAttributeName: 'className',
    forceScoping: true,
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

  const stylePlugin = stylePlugins[variation]

  if (!stylePlugin) {
    throw new Error(`Invalid style variation '${variation}'`)
  }

  const generator = createComponentGenerator()

  generator.addMapping(ReactMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(propTypesPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))

  // Import plugin needs to be last to handle all dependencies
  // TODO: use a different function to set/interact with the import plugin
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJSX)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createReactComponentGenerator, ReactMapping, ReactStyleVariation }
