import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import { createReactStyledComponentsPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import inlineStylesPlugin from '@teleporthq/teleport-plugin-jsx-inline-styles'
import propTypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import resourceLoaderPlugin from '@teleporthq/teleport-plugin-reactnative-resource-loader'
import navigationPlugin from '@teleporthq/teleport-plugin-reactnative-component-navigation'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { ReactNativeMapping } from './react-native-mapping'
import {
  ComponentGenerator,
  ReactNativeStyleVariation,
  GeneratorFactoryParams,
  ComponentGeneratorInstance,
} from '@teleporthq/teleport-types'

// This extracts Text, View, Image as illegal element names
const illegalElementNames = Object.keys(ReactNativeMapping.elements).map(
  (key) => ReactNativeMapping.elements[key].elementType
)

const styledComponentsPlugin = createReactStyledComponentsPlugin({
  componentLibrary: 'reactnative',
  illegalComponentNames: [...ReactNativeMapping.illegalClassNames, ...illegalElementNames],
})

const stylePlugins = {
  [ReactNativeStyleVariation.InlineStyles]: inlineStylesPlugin,
  [ReactNativeStyleVariation.StyledComponents]: styledComponentsPlugin,
}

const createReactNativeComponentGenerator: ComponentGeneratorInstance = ({
  variation = ReactNativeStyleVariation.StyledComponents,
  mappings = [],
  postprocessors = [],
  plugins = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()
  const stylePlugin = stylePlugins[variation as ReactNativeStyleVariation] || inlineStylesPlugin

  generator.addMapping(ReactNativeMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(stylePlugin)
  generator.addPlugin(propTypesPlugin)
  generator.addPlugin(resourceLoaderPlugin)
  generator.addPlugin(navigationPlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJSX)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

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
