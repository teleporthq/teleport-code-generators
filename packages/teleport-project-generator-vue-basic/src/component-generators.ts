import { createGenerator } from '@teleporthq/teleport-component-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { createHtmlIndexFile } from '@teleporthq/teleport-project-generator/lib/utils'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import { EntryFileOptions } from '@teleporthq/teleport-project-generator/lib/types'
import {
  ComponentUIDL,
  ProjectUIDL,
  Mapping,
  ChunkDefinition,
  GeneratorOptions,
  ComponentGenerator,
} from '@teleporthq/teleport-types'

import vueProjectMapping from './vue-project-mapping.json'

export const createRouterFile = async (root: ComponentUIDL, options: GeneratorOptions) => {
  const vueRouterGenerator = createGenerator()

  vueRouterGenerator.addPlugin(vueRoutingPlugin)
  vueRouterGenerator.addPlugin(importStatementsPlugin)

  vueRouterGenerator.addPostProcessor(prettierJS)

  // Routes are defined in router.js
  root.meta = root.meta || {}
  root.meta.fileName = 'router'

  const { files } = await vueRouterGenerator.generateComponent(root, options)
  return files[0]
}

export const createHtmlEntryFile = async (projectUIDL: ProjectUIDL, options: EntryFileOptions) => {
  const htmlFileGenerator = createGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const fileHAST = createHtmlIndexFile(projectUIDL, options)
  const chunks: Record<string, ChunkDefinition[]> = {
    [FILE_TYPE.HTML]: [
      {
        name: 'doctype',
        type: 'string',
        content: '<!DOCTYPE>',
        linkAfter: [],
      },
      {
        name: 'html-node',
        type: 'html',
        content: fileHAST,
        linkAfter: ['doctype'],
      },
    ],
  }

  // html file is generated as index.html
  const htmlFilename = 'index'
  const [htmlFile] = htmlFileGenerator.linkCodeChunks(chunks, htmlFilename)
  return htmlFile
}

export const createVueGenerator = (): ComponentGenerator => {
  const vueGenerator = createVueComponentGenerator(vueProjectMapping as Mapping)
  return vueGenerator
}
