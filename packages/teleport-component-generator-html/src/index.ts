import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createHTMLBasePlugin } from '@teleporthq/teleport-plugin-html-base-component'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements-html'
import { createPrettierHTMLPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-html'
import {
  HTMLComponentGeneratorInstance,
  HTMLComponentGenerator,
  ComponentUIDL,
  GeneratorFactoryParams,
  GeneratorOptions,
} from '@teleporthq/teleport-types'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { StringUtils } from '@teleporthq/teleport-shared'
import { Parser } from '@teleporthq/teleport-uidl-validator'
import { Resolver } from '@teleporthq/teleport-uidl-resolver'
import { PlainHTMLMapping } from './plain-html-mapping'

const createHTMLComponentGenerator: HTMLComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
  strictHtmlWhitespaceSensitivity = false,
}: GeneratorFactoryParams = {}): HTMLComponentGenerator => {
  const generator = createComponentGenerator()
  const { htmlComponentPlugin, addExternals } = createHTMLBasePlugin()
  const resolver = new Resolver()
  resolver.addMapping(PlainHTMLMapping)
  mappings.forEach((mapping) => resolver.addMapping(mapping))

  const prettierHTML = createPrettierHTMLPostProcessor({
    strictHtmlWhitespaceSensitivity,
  })

  Object.defineProperty(generator, 'addExternalComponents', {
    value: (params: {
      externals: Record<string, ComponentUIDL>
      skipValidation?: boolean
      assets?: GeneratorOptions['assets']
    }) => {
      const { externals = {}, skipValidation = false, assets = {} } = params
      addExternals(
        Object.keys(externals).reduce((acc: Record<string, ComponentUIDL>, ext) => {
          const componentUIDL = skipValidation
            ? externals[ext]
            : Parser.parseComponentJSON(externals[ext] as unknown as Record<string, unknown>)
          const resolvedUIDL = resolver.resolveUIDL(componentUIDL, {
            assets,
            extractedResources: {},
          })
          acc[StringUtils.dashCaseToUpperCamelCase(ext)] = resolvedUIDL
          return acc
        }, {}),
        plugins
      )
    },
  })

  generator.addPlugin(htmlComponentPlugin)
  generator.addPlugin(
    createCSSPlugin({
      templateChunkName: 'html-chunk',
      declareDependency: 'import',
      forceScoping: true,
      templateStyle: 'html',
      staticPropReferences: true,
    })
  )

  plugins.forEach((plugin) => generator.addPlugin(plugin))
  mappings.forEach((mapping) => generator.addMapping(mapping))
  generator.addMapping(PlainHTMLMapping)

  generator.addPlugin(importStatementsPlugin)

  postprocessors.forEach((postProcessor) => generator.addPostProcessor(postProcessor))
  generator.addPostProcessor(prettierHTML)

  return generator as HTMLComponentGenerator
}

export { createHTMLComponentGenerator, PlainHTMLMapping }
