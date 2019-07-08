import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'
import importStatementsPlugin from '@teleporthq/teleport-plugin-typescript-import-statements'

import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierTS from '@teleporthq/teleport-postprocessor-prettier-ts'

import anuglarMapping from './angular-mapping.json'
import { Mapping, ComponentGenerator } from '@teleporthq/teleport-types'

export const createAngularComponentGenerator = (mapping: Mapping = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(anuglarMapping)
  generator.addMapping(mapping)

  generator.addPlugin(angularComponentPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierTS)
  generator.addPostProcessor(prettierHTML)

  return generator
}
