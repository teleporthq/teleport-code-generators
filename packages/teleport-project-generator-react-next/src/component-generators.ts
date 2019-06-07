import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createGenerator } from '@teleporthq/teleport-component-generator'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import {
  GeneratorOptions,
  ComponentGenerator,
  ChunkDefinition,
  Mapping,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

import { createDocumentComponentAST } from './utils'
import nextMapping from './next-mapping.json'

export const createReactGenerator = (options: GeneratorOptions): ComponentGenerator => {
  const reactGenerator = createReactComponentGenerator('StyledJSX')

  reactGenerator.addMapping(nextMapping as Mapping)
  if (options.mapping) {
    reactGenerator.addMapping(options.mapping)
  }

  return reactGenerator
}

export const createDocumentFile = (projectUIDL: ProjectUIDL) => {
  const generator = createGenerator()
  generator.addPostProcessor(prettierJS)

  const fileAST = createDocumentComponentAST(projectUIDL)
  const chunks: Record<string, ChunkDefinition[]> = {
    [FILE_TYPE.JS]: [
      {
        name: 'document',
        type: 'js',
        content: fileAST,
        linkAfter: [],
      },
    ],
  }

  // html file is generated as index.html
  const documentFilename = '_document'
  const [docFile] = generator.linkCodeChunks(chunks, documentFilename)
  return docFile
}
