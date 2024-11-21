import {
  ChunkType,
  ComponentStructure,
  ComponentUIDL,
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectType,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import {
  createJSXSyntax,
  ASTBuilders,
  JSXGenerationParams,
} from '@teleporthq/teleport-plugin-common'
import { CodeGenerator } from '@babel/generator'
import * as types from '@babel/types'
import { Resolver } from '@teleporthq/teleport-uidl-resolver'
import { ReactMapping } from '@teleporthq/teleport-component-generator-react'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'

export class ProjectPlugini18nFiles implements ProjectPlugin {
  projectType: ProjectType
  resolver: Resolver

  constructor(params: { projectType: ProjectType }) {
    this.projectType = params.projectType
    this.resolver = new Resolver(ReactMapping)
  }

  async generateJSX(node: UIDLElementNode): Promise<{ html: string; css?: string }> {
    const proxyUIDL: ComponentUIDL = {
      name: 'locale-node',
      node,
    }
    const resolvedUIDL = this.resolver.resolveUIDL(proxyUIDL)

    const jsxParams: JSXGenerationParams = {
      stateDefinitions: {},
      propDefinitions: {},
      windowImports: {},
      dependencies: {},
      nodesLookup: {},
      localeReferences: [],
      globalReferences: [],
    }

    const jsxNodeAst = createJSXSyntax(resolvedUIDL.node, jsxParams, {
      dynamicReferencePrefixMap: {
        prop: 'props',
        state: '',
        local: '',
      },
      dependencyHandling: 'import',
      stateHandling: 'hooks',
      slotHandling: 'props',
      domHTMLInjection: (content: string) => ASTBuilders.createDOMInjectionNode(content),
    })

    const initialStructure: ComponentStructure = {
      uidl: resolvedUIDL,
      chunks: [
        {
          type: ChunkType.AST,
          name: 'jsx-component',
          fileType: FileType.JS,
          meta: {
            nodesLookup: jsxParams.nodesLookup,
            dynamicRefPrefix: {},
          },
          content: jsxNodeAst,
          linkAfter: [],
        },
      ],
      dependencies: {},
      options: {},
    }

    const result = await createCSSPlugin({
      templateChunkName: 'jsx-component',
      templateStyle: 'jsx',
    })(initialStructure)

    const resultJSXChunk = result.chunks.find((chunk) => chunk.type === ChunkType.AST)
    const resultCSSChunk = result.chunks.find(
      (chunk) => chunk.type === ChunkType.STRING && chunk.fileType === FileType.CSS
    )
    const jsx = new CodeGenerator(resultJSXChunk.content as types.JSXElement, {
      jsescOption: { minimal: true },
    }).generate()

    return {
      html: jsx.code,
      css: typeof resultCSSChunk?.content === 'string' ? resultCSSChunk?.content : undefined,
    }
  }

  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure

    const { translations = { en: {} } } = uidl.internationalization || {}
    const promises: Array<Promise<Record<string, string>>> = []

    for (const locale of Object.keys(translations)) {
      const translation = translations[locale]
      for (const id of Object.keys(translation)) {
        const item = translation[id]

        if (item?.type === 'element') {
          promises.push(
            new Promise((resolve) => {
              this.generateJSX(item).then(({ html, css }) => {
                resolve({ [id]: css ? `${html} \n <style>${css}</style>` : html })
              })
            })
          )
        }

        if (item?.type === 'static') {
          promises.push(new Promise((resolve) => resolve({ [id]: String(item.content) })))
        }
      }

      try {
        const result = await Promise.all(promises)
        const content = result.reduce((acc, item) => ({ ...acc, ...item }), {})

        files.set(locale, {
          path: ['locales'],
          files: [
            {
              name: locale,
              content: JSON.stringify(content, null, 2),
              fileType: FileType.JSON,
            },
          ],
        })
      } catch (error) {
        /* tslint:disable no-console */
        console.error('Error generating i18n files', error)
      }
    }

    return structure
  }
}
