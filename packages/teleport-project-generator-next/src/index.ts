import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'

import { createJSXHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-js'

import { Mapping, ReactStyleVariation } from '@teleporthq/teleport-types'

import { createDocumentFileChunks } from './utils'
import NextMapping from './next-mapping.json'
import NextTemplate from './project-template'

const createNextProjectGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)
  reactComponentGenerator.addMapping(NextMapping as Mapping)

  const headConfigPlugin = createJSXHeadConfigPlugin({
    configTagIdentifier: 'Head',
    configTagDependencyPath: 'next/head',
  })

  const reactPageGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX, {
    plugins: [headConfigPlugin],
    mappings: [NextMapping as Mapping],
  })

  const documentFileGenerator = createComponentGenerator()
  documentFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: reactPageGenerator,
      path: ['pages'],
      options: {
        useFileNameForNavigation: true,
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
