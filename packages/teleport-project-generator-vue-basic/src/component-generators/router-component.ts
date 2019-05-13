import { createGenerator } from '@teleporthq/teleport-component-generator'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import htmlMapping from './html-mapping.json'
import vueMapping from './vue-mapping.json'

import {
  GeneratorOptions,
  ComponentGenerator,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createVueRouterGenerator = (
  { mapping }: GeneratorOptions = { mapping }
): ComponentGenerator => {
  const generator = createGenerator()

  generator.addMapping(htmlMapping as Mapping)
  generator.addMapping(vueMapping)
  generator.addMapping(mapping)

  generator.addPlugin(vueRoutingPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createVueRouterGenerator
