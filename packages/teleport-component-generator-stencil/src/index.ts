import stencilComponentPlugin from '@teleporthq/teleport-plugin-stencil-base-component'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createPrettierJSPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'

import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import {
  ComponentGenerator,
  FileType,
  ComponentGeneratorInstance,
} from '@teleporthq/teleport-types'

import StencilMapping from './stencil-mapping.json'

const createStencilComponentGenerator: ComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  const importStatementsPlugin = createImportPlugin({ fileType: FileType.TSX })
  const stencilStylePlugin = createCSSPlugin({
    declareDependency: 'decorator',
    templateStyle: 'jsx',
    templateChunkName: 'jsx-component',
  })
  const prettierJS = createPrettierJSPostProcessor({ fileType: FileType.TSX })

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
