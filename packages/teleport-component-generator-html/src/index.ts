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
  ElementsLookup,
} from '@teleporthq/teleport-types'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { StringUtils } from '@teleporthq/teleport-shared'
import { Parser } from '@teleporthq/teleport-uidl-validator'
import { createNodesLookup, Resolver } from '@teleporthq/teleport-uidl-resolver'
import { PlainHTMLMapping } from './plain-html-mapping'

const createHTMLComponentGenerator: HTMLComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
  strictHtmlWhitespaceSensitivity = false,
}: GeneratorFactoryParams = {}): HTMLComponentGenerator => {
  const generator = createComponentGenerator()
  const resolver = new Resolver()
  resolver.addMapping(PlainHTMLMapping)
  mappings.forEach((mapping) => resolver.addMapping(mapping))
  const nodesLookup: ElementsLookup = {}

  const prettierHTML = createPrettierHTMLPostProcessor({
    strictHtmlWhitespaceSensitivity,
  })

  Object.defineProperty(generator, 'addExternalComponents', {
    value: (params: {
      externals: Record<string, ComponentUIDL>
      assets?: GeneratorOptions['assets']
    }) => {
      const { externals = {}, assets = {} } = params
      const componentUIDLs: Record<string, ComponentUIDL> = {}

      for (const uidlKey of Object.keys(externals)) {
        // Parsig the UIDL, so they are converting into proper ComponentUIDL
        const componentUIDL = Parser.parseComponentJSON(
          externals[uidlKey] as unknown as Record<string, unknown>
        )

        createNodesLookup(componentUIDL.node, nodesLookup)
        const resolvedUIDL = resolver.resolveUIDL(componentUIDL, { assets }, nodesLookup)

        componentUIDLs[
          StringUtils.dashCaseToUpperCamelCase(resolvedUIDL.outputOptions.componentClassName)
        ] = resolvedUIDL
      }

      addExternals(componentUIDLs, plugins)
    },
  })

  const { htmlComponentPlugin, addExternals } = createHTMLBasePlugin({ nodesLookup })
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
