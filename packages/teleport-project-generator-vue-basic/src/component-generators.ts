import { createGenerator } from '@teleporthq/teleport-component-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { createHtmlIndexFile } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'

import {
  ComponentUIDL,
  ProjectUIDL,
  Mapping,
} from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import {
  ChunkDefinition,
  ProjectGeneratorOptions,
  ComponentGenerator,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import vueProjectMapping from './vue-project-mapping.json'

export const createRouterFile = async (root: ComponentUIDL) => {
  const vueRouterGenerator = createGenerator()

  vueRouterGenerator.addPlugin(vueRoutingPlugin)
  vueRouterGenerator.addPlugin(importStatementsPlugin)

  vueRouterGenerator.addPostProcessor(prettierJS)

  // Routes are defined in router.js
  root.meta = root.meta || {}
  root.meta.fileName = 'router'

  const { files, dependencies } = await vueRouterGenerator.generateComponent(root)
  const routerFile = files[0]

  return { routerFile, dependencies }
}

export const createHtmlEntryFile = (projectUIDL: ProjectUIDL, options) => {
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

export const createVueGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueComponentGenerator({
    mapping: vueProjectMapping as Mapping,
  })

  if (options.customMapping) {
    vueGenerator.addMapping(options.customMapping)
  }

  return vueGenerator
}
