import preactComponentPlugin from '@teleporthq/teleport-plugin-preact-base-component'
import reactInlineStylesPlugin from '@teleporthq/teleport-plugin-react-inline-styles'
import reactJSSPlugin from '@teleporthq/teleport-plugin-react-jss'
import reactCSSModulesPlugin from '@teleporthq/teleport-plugin-react-css-modules'
import reactStyledComponentsPlugin from '@teleporthq/teleport-plugin-react-styled-components'
import reactStyledJSXPlugin from '@teleporthq/teleport-plugin-react-styled-jsx'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import preactMapping from './preact-mapping.json'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

const stylePlugins = {
  InlineStyles: reactInlineStylesPlugin,
  StyledComponents: reactStyledComponentsPlugin,
  StyledJSX: reactStyledJSXPlugin,
  CSSModules: reactCSSModulesPlugin,
  JSS: reactJSSPlugin,
}

export const createPreactComponentGenerator = (
  variation: string = 'InlineStyles',
  mapping: Mapping = {}
): ComponentGenerator => {
  const stylePlugin = stylePlugins[variation] || reactInlineStylesPlugin

  const generator = createComponentGenerator()

  generator.addMapping(preactMapping)
  generator.addMapping(mapping)

  generator.addPlugin(preactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createPreactComponentGenerator()
