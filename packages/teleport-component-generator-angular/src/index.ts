import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { createPlugin as createStylePlugin } from '@teleporthq/teleport-plugin-css'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'

import AngularMapping from './angular-mapping.json'
import { ComponentGenerator, FileType } from '@teleporthq/teleport-types'

const importStatementsPlugin = createImportPlugin({ fileType: FileType.TS })
const prettierJS = createPostProcessor({ fileType: FileType.TS })
const stylePlugin = createStylePlugin({
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

  generator.addPostProcessor(prettierJS)
  generator.addPostProcessor(prettierHTML)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createAngularComponentGenerator, AngularMapping }
