import createLitElementComponentPlugin from '@teleporthq/teleport-plugin-lit-element-base-component'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import prettierTS from '@teleporthq/teleport-postprocessor-prettier-ts'
import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'
import { ComponentGenerator, FileType } from '@teleporthq/teleport-types'

import LitElementMappings from './lit-element-mapping.json'

const importStatementsPlugin = createImportPlugin({ fileType: FileType.TS })

const createLitElementComponentGenerator = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(LitElementMappings)
  mappings.forEach((mapping) => generator.addMapping(mapping))

  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(createLitElementComponentPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierTS)
  postprocessors.forEach((postprocessor) => generator.addPostProcessor(postprocessor))

  return generator
}

export { createLitElementComponentGenerator }
