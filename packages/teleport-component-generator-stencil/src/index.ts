import stencilComponentPlugin from '@teleporthq/teleport-plugin-stencil-base-component'
import stencilStylePlugin from '@teleporthq/teleport-plugin-stencil-css'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

import stencilMapping from './stencil-mapping.json'

export const createStencilComponentGenerator = (mapping: Mapping = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(stencilMapping)
  generator.addMapping(mapping)

  generator.addPlugin(stencilComponentPlugin)
  generator.addPlugin(stencilStylePlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createStencilComponentGenerator()
