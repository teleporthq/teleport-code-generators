import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import reactInlineStylesPlugin from '@teleporthq/teleport-plugin-react-inline-styles'
import reactJSSPlugin from '@teleporthq/teleport-plugin-react-jss'
import reactCSSModulesPlugin from '@teleporthq/teleport-plugin-react-css-modules'
import reactStyledComponentsPlugin from '@teleporthq/teleport-plugin-react-styled-components'
import reactStyledJSXPlugin from '@teleporthq/teleport-plugin-react-styled-jsx'
import reactPropTypesPlugin from '@teleporthq/teleport-plugin-react-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createGenerator } from '@teleporthq/teleport-component-generator'

import reactMapping from './react-mapping.json'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

const stylePlugins = {
  InlineStyles: reactInlineStylesPlugin,
  StyledComponents: reactStyledComponentsPlugin,
  StyledJSX: reactStyledJSXPlugin,
  CSSModules: reactCSSModulesPlugin,
  JSS: reactJSSPlugin,
}

export const createReactComponentGenerator = (
  variation: string = 'InlineStyles',
  mapping: Mapping = {}
): ComponentGenerator => {
  const stylePlugin = stylePlugins[variation] || reactInlineStylesPlugin

  const generator = createGenerator()

  generator.addMapping(reactMapping)
  generator.addMapping(mapping)

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(reactPropTypesPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createReactComponentGenerator()
