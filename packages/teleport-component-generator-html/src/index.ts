import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createHTMLBasePlugin } from '@teleporthq/teleport-plugin-html-base-component'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements-html'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import {
  ComponentGenerator,
  ComponentUIDL,
  GeneratorFactoryParams,
} from '@teleporthq/teleport-types'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { StringUtils } from '@teleporthq/teleport-shared'
import { Parser } from '@teleporthq/teleport-uidl-validator'
import { HTMLMapping, Resolver } from '@teleporthq/teleport-uidl-resolver'

interface HTMLComponentGenerator extends ComponentGenerator {
  addExternalComponents: (params: {
    externals: Record<string, ComponentUIDL>
    skipValidation?: boolean
  }) => void
}
type HTMLComponentGeneratorInstance = (params?: GeneratorFactoryParams) => HTMLComponentGenerator

const createHTMLComponentGenerator: HTMLComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
}: GeneratorFactoryParams = {}): HTMLComponentGenerator => {
  const generator = createComponentGenerator()
  const { htmlComponentPlugin, addExternals } = createHTMLBasePlugin()
  const resolver = new Resolver(HTMLMapping)

  Object.defineProperty(generator, 'addExternalComponents', {
    value: (params: { externals: Record<string, ComponentUIDL>; skipValidation?: boolean }) => {
      const { externals = {}, skipValidation = false } = params
      addExternals(
        Object.keys(externals).reduce((acc: Record<string, ComponentUIDL>, ext) => {
          acc[StringUtils.dashCaseToUpperCamelCase(ext)] = resolver.resolveUIDL(
            skipValidation
              ? externals[ext]
              : Parser.parseComponentJSON(externals[ext] as unknown as Record<string, unknown>)
          )
          return acc
        }, {})
      )
    },
  })

  generator.addPlugin(htmlComponentPlugin)
  generator.addPlugin(
    createCSSPlugin({
      templateChunkName: 'html-template',
      declareDependency: 'import',
      forceScoping: true,
    })
  )
  generator.addMapping(HTMLMapping)
  mappings.forEach((mapping) => generator.addMapping(mapping))
  plugins.forEach((plugin) => generator.addPlugin(plugin))
  generator.addPlugin(importStatementsPlugin)

  postprocessors.forEach((postProcessor) => generator.addPostProcessor(postProcessor))
  generator.addPostProcessor(prettierHTML)

  return generator as HTMLComponentGenerator
}

export { createHTMLComponentGenerator }
