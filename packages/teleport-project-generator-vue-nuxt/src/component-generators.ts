import { createGenerator } from '@teleporthq/teleport-component-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'

import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { EntryFileOptions } from '@teleporthq/teleport-project-generator/lib/types'
import { createHtmlIndexFile } from '@teleporthq/teleport-project-generator/lib/utils'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

import {
  ProjectUIDL,
  Mapping,
  ChunkDefinition,
  ComponentGenerator,
} from '@teleporthq/teleport-types'

import nuxtMapping from './nuxt-mapping.json'

const APP_ROOT_OVERRIDE = '{{ APP }}'

export const createHtmlEntryFile = async (projectUIDL: ProjectUIDL, options: EntryFileOptions) => {
  const htmlFileGenerator = createGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const fileHAST = createHtmlIndexFile(projectUIDL, {
    ...options,
    appRootOverride: APP_ROOT_OVERRIDE,
  })
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

export const createVueGenerator = (): ComponentGenerator => {
  const vueGenerator = createVueComponentGenerator(nuxtMapping as Mapping)
  return vueGenerator
}
