import reactComponentPlugin from '@teleporthq/teleport-plugin-react-base-component'
import { createPlugin as createStyledComponentsPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import propTypesPlugin from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactNativeMapping from './react-native-mapping.json'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

const styledComponentsPlugin = createStyledComponentsPlugin({
  componentLibrary: 'reactnative',
})

export const createReactNativeComponentGenerator = (mapping: Mapping = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(reactNativeMapping as Mapping)
  generator.addMapping(mapping)

  generator.addPlugin(reactComponentPlugin)
  generator.addPlugin(styledComponentsPlugin)
  generator.addPlugin(propTypesPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createReactNativeComponentGenerator()
