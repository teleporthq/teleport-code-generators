import { createGenerator } from '@teleporthq/teleport-component-generator'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { ComponentGenerator } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const createVueRouterGenerator = (): ComponentGenerator => {
  const generator = createGenerator()

  generator.addPlugin(vueRoutingPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createVueRouterGenerator
