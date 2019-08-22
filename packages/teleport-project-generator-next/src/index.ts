import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'

import { createPlugin as createHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { Mapping } from '@teleporthq/teleport-types'

import { createDocumentFileChunks } from './utils'
import nextMapping from './next-mapping.json'

const headConfigPlugin = createHeadConfigPlugin({
  configTagIdentifier: 'Head',
  configTagDependencyPath: 'next/head',
})

export const createNextProjectGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator('StyledJSX')
  reactComponentGenerator.addMapping(nextMapping as Mapping)

  const reactPageGenerator = createReactComponentGenerator('StyledJSX', [headConfigPlugin])
  reactPageGenerator.addMapping(nextMapping as Mapping)

  const documentFileGenerator = createComponentGenerator()
  documentFileGenerator.addPostProcessor(prettierJS)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: reactPageGenerator,
      path: ['pages'],
      options: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    },
    entry: {
      generator: documentFileGenerator,
      path: ['pages'],
      fileName: '_document',
      chunkGenerationFunction: createDocumentFileChunks,
    },
    static: {
      prefix: '/static',
      path: ['static'],
    },
  })

  return generator
}

export default createNextProjectGenerator()
