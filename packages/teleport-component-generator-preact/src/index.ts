import preactComponentPlugin from '@teleporthq/teleport-plugin-preact-base-component'
import { createPlugin as createCSSModulesPlugin } from '@teleporthq/teleport-plugin-react-css-modules'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import proptypesPlugin from '@teleporthq/teleport-plugin-react-proptypes'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import preactMapping from './preact-mapping.json'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

const cssModulesPlugin = createCSSModulesPlugin({
  classAttributeName: 'class',
})

export const createPreactComponentGenerator = (mapping: Mapping = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(preactMapping)
  generator.addMapping(mapping)

  generator.addPlugin(preactComponentPlugin)
  generator.addPlugin(cssModulesPlugin)
  generator.addPlugin(proptypesPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createPreactComponentGenerator()
