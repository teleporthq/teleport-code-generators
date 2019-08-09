import stencilComponentPlugin from '@teleporthq/teleport-plugin-stencil-base-component'
import { createPlugin as createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import { ComponentGenerator, Mapping } from '@teleporthq/teleport-types'

import stencilMapping from './stencil-mapping.json'

const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TSX })
const stencilStylePlugin = createCSSPlugin({
  declareDependency: 'decorator',
  templateStyle: 'jsx',
  templateChunkName: 'jsx-component',
})
const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TSX })

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
