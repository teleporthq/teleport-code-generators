import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createJSXHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { Mapping, ReactStyleVariation, FileType } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import { createDocumentFileChunks, configContentGenerator } from './utils'
import NextMapping from './next-mapping.json'
import NextTemplate from './project-template'

const createNextProjectGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)
  reactComponentGenerator.addMapping(NextMapping as Mapping)

  const headConfigPlugin = createJSXHeadConfigPlugin({
    configTagIdentifier: 'Head',
    configTagDependencyPath: 'next/head',
    isExternalPackage: false,
  })

  const reactPageGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX, {
    plugins: [headConfigPlugin],
    mappings: [NextMapping as Mapping],
  })

  const documentFileGenerator = createComponentGenerator()
  documentFileGenerator.addPostProcessor(prettierJS)

  const styleSheetGenerator = createComponentGenerator()
  styleSheetGenerator.addPlugin(createStyleSheetPlugin())

  const configGenerator = createComponentGenerator()
  configGenerator.addPlugin(importStatementsPlugin)
  configGenerator.addPostProcessor(prettierJS)

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
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['pages'],
    },
    entry: {
      generator: documentFileGenerator,
      path: ['pages'],
      fileName: '_document',
      chunkGenerationFunction: createDocumentFileChunks,
    },
    framework: {
      config: {
        fileName: `_app`,
        fileType: FileType.JS,
        path: ['pages'],
        generator: configGenerator,
        configContentGenerator,
        isGlobalStylesDependent: true,
      },
      externalStyles: {
        fileName: '_app',
        fileType: FileType.JS,
      },
    },
    static: {
      prefix: '',
      path: ['public'],
    },
  })

  return generator
}

export { createNextProjectGenerator, NextMapping, NextTemplate }
