import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import htmlBasePlugin from '@teleporthq/teleport-plugin-html-base-component'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements-html'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { ComponentGenerator, ComponentGeneratorInstance } from '@teleporthq/teleport-types'
import {
  createComponentGenerator,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-component-generator'

const createHTMLComponentGenerator: ComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addPlugin(htmlBasePlugin)
  generator.addPlugin(
    createCSSPlugin({
      templateChunkName: 'html-template',
      declareDependency: 'import',
    })
  )
  mappings.forEach((mapping) => generator.addMapping(mapping))
  plugins.forEach((plugin) => generator.addPlugin(plugin))

  generator.addPlugin(importStatementsPlugin)

  postprocessors.forEach((postProcessor) => generator.addPostProcessor(postProcessor))
  generator.addPostProcessor(prettierHTML)

  return generator
}

export { createHTMLComponentGenerator }
