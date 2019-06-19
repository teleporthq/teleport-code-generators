import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import vueComponentPlugin from '@teleporthq/teleport-plugin-vue-base-component'
import vueStylePlugin from '@teleporthq/teleport-plugin-vue-css'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import vueFile from '@teleporthq/teleport-postprocessor-vue-file'

import vueMapping from './vue-mapping.json'

import { Mapping, ComponentGenerator } from '@teleporthq/teleport-types'

export const createVueComponentGenerator = (mapping: Mapping = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(vueMapping)
  generator.addMapping(mapping)

  generator.addPlugin(vueComponentPlugin)
  generator.addPlugin(vueStylePlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)
  generator.addPostProcessor(prettierHTML)
  generator.addPostProcessor(vueFile)

  return generator
}

export default createVueComponentGenerator()
