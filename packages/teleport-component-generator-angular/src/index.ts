import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import prettierTS from '@teleporthq/teleport-postprocessor-prettier-ts'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import AngularMapping from './angular-mapping.json'
import { ComponentGenerator, FileType } from '@teleporthq/teleport-types'

const importStatementsPlugin = createImportPlugin({ fileType: FileType.TS })
const stylePlugin = createCSSPlugin({
  inlineStyleAttributeKey: '[ngStyle]',
  declareDependency: 'decorator',
})

const createAngularComponentGenerator = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(AngularMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  generator.addPlugin(angularComponentPlugin)
  generator.addPlugin(stylePlugin)
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierTS)
  generator.addPostProcessor(prettierHTML)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createAngularComponentGenerator, AngularMapping }
