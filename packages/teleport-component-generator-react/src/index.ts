import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import reactInlineStylesPlugin from '@teleporthq/teleport-plugin-react-inline-styles'
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

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

const cssPlugin = createCSSPlugin({
  templateChunkName: 'jsx-component',
  templateStyle: 'jsx',
  declareDependency: 'import',
})

const cssModulesPlugin = createCSSModulesPlugin({ moduleExtension: true })

const stylePlugins = {
  InlineStyles: reactInlineStylesPlugin,
  StyledComponents: reactStyledComponentsPlugin,
  StyledJSX: reactStyledJSXPlugin,
  CSSModules: cssModulesPlugin,
  CSS: cssPlugin,
  JSS: reactJSSPlugin,
}

export const createReactComponentGenerator = (
  variation: string = 'CSS',
  mapping: Mapping = {}
): ComponentGenerator => {
  const stylePlugin = stylePlugins[variation] || reactInlineStylesPlugin

  const generator = createComponentGenerator()

  generator.addMapping(reactMapping)
  generator.addMapping(mapping)

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(propTypesPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createReactComponentGenerator()
