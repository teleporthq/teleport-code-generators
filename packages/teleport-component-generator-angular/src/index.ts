import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { createPlugin as createStylePlugin } from '@teleporthq/teleport-plugin-css'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'

import AngularMapping from './angular-mapping.json'
import { ComponentGenerator } from '@teleporthq/teleport-types'

const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TS })
const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TS })
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
