import { createGenerator } from '@teleporthq/teleport-component-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'

import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { createHtmlIndexFile } from '@teleporthq/teleport-shared/lib/utils/project-utils'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

import {
  ProjectUIDL,
  Mapping,
  ChunkDefinition,
  GeneratorOptions,
  ComponentGenerator,
} from '@teleporthq/teleport-types'

import nuxtMapping from './nuxt-mapping.json'

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

  // html file is generated as app.html
  const htmlFilename = 'app'
  const [htmlFile] = htmlFileGenerator.linkCodeChunks(chunks, htmlFilename)
  return htmlFile
}

export const createVueGenerator = (options: GeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueComponentGenerator({
    mapping: nuxtMapping as Mapping,
  })

  if (options.mapping) {
    vueGenerator.addMapping(options.mapping)
  }

  return vueGenerator
}
