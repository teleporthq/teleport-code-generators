import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import {
  createReactComponentGenerator,
  ReactStyleVariation,
} from '@teleporthq/teleport-component-generator-react'

import { createPlugin as createHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { Mapping } from '@teleporthq/teleport-types'

import { createDocumentFileChunks } from './utils'
import NextMapping from './next-mapping.json'
import NextTemplate from './project-template'

const headConfigPlugin = createHeadConfigPlugin({
  configTagIdentifier: 'Head',
  configTagDependencyPath: 'next/head',
})

const createNextProjectGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)
  reactComponentGenerator.addMapping(NextMapping as Mapping)

  const reactPageGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX, {
    plugins: [headConfigPlugin],
    mappings: [NextMapping as Mapping],
  })

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

export { createNextProjectGenerator, NextMapping, NextTemplate }

export default createNextProjectGenerator()
