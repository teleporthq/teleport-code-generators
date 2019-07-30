import stencilComponentPlugin from '@teleporthq/teleport-plugin-stencil-base-component'
import stencilStylePlugin from '@teleporthq/teleport-plugin-stencil-css'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

import stencilMapping from './stencil-mapping.json'

const importStatementsPlugin = createImportPlugin({ fileId: FILE_TYPE.TSX })

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
