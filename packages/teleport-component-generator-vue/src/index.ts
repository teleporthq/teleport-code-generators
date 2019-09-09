import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import vueComponentPlugin from '@teleporthq/teleport-plugin-vue-base-component'
import { createPlugin as createVueStylePlugin } from '@teleporthq/teleport-plugin-css'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import vueFile from '@teleporthq/teleport-postprocessor-vue-file'

import VueMapping from './vue-mapping.json'

import { ComponentGenerator } from '@teleporthq/teleport-types'

const createVueComponentGenerator = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()
  const vueStylePlugin = createVueStylePlugin({
    inlineStyleAttributeKey: ':style',
  })

  generator.addMapping(VueMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(vueComponentPlugin)
  generator.addPlugin(vueStylePlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)
  generator.addPostProcessor(prettierHTML)
  generator.addPostProcessor(vueFile)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createVueComponentGenerator, VueMapping }

export default createVueComponentGenerator()
