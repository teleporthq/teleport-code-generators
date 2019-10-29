import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import { createReactStyledComponentsPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import propTypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import resourceLoaderPlugin from '@teleporthq/teleport-plugin-reactnative-resource-loader'
import navigationPlugin from '@teleporthq/teleport-plugin-reactnative-component-navigation'

import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import ReactNativeMapping from './react-native-mapping.json'

import { ComponentGenerator, Mapping, ReactNativeStyleVariation } from '@teleporthq/teleport-types'

// This extracts Text, View, Image as illegal element names
const rnMapping = ReactNativeMapping as Mapping
const illegalElementNames = Object.keys(rnMapping.elements).map(
  (key) => rnMapping.elements[key].elementType
)

const styledComponentsPlugin = createReactStyledComponentsPlugin({
  componentLibrary: 'reactnative',
  illegalComponentNames: [...ReactNativeMapping.illegalClassNames, ...illegalElementNames],
})

const stylePlugins = {
  [ReactNativeStyleVariation.InlineStyles]: inlineStylesPlugin,
  [ReactNativeStyleVariation.StyledComponents]: styledComponentsPlugin,
}

const createReactNativeComponentGenerator = (
  variation = ReactNativeStyleVariation.StyledComponents,
  mapping: Mapping = {}
): ComponentGenerator => {
  const generator = createComponentGenerator()
  const stylePlugin = stylePlugins[variation] || inlineStylesPlugin

  generator.addMapping(ReactNativeMapping as Mapping)
  generator.addMapping(mapping)

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(propTypesPlugin)
  generator.addPlugin(resourceLoaderPlugin)
  generator.addPlugin(navigationPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJSX)

  const originalGeneratorFn = generator.generateComponent

  // Until we figure out a better way to skip the resolve navlink functionality
  generator.generateComponent = (uidl, options) =>
    originalGeneratorFn(uidl, {
      ...options,
      skipNavlinkResolver: true,
    })

  return generator
}

export { createReactNativeComponentGenerator, ReactNativeMapping, ReactNativeStyleVariation }

export default createReactNativeComponentGenerator()
