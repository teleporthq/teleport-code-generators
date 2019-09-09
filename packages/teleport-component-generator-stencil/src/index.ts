import stencilComponentPlugin from '@teleporthq/teleport-plugin-stencil-base-component'
import { createPlugin as createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'

import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import { ComponentGenerator } from '@teleporthq/teleport-types'

import StencilMapping from './stencil-mapping.json'

const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TSX })
const stencilStylePlugin = createCSSPlugin({
  declareDependency: 'decorator',
  templateStyle: 'jsx',
  templateChunkName: 'jsx-component',
})
const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TSX })

const createStencilComponentGenerator = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(StencilMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(stencilComponentPlugin)
  generator.addPlugin(stencilStylePlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createStencilComponentGenerator, StencilMapping }

export default createStencilComponentGenerator()
