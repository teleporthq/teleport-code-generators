import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { createGenerator } from '@teleporthq/teleport-component-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'

import { createHtmlIndexFile } from '@teleporthq/teleport-shared/lib/utils/project-utils'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import {
  ComponentUIDL,
  ProjectUIDL,
  Mapping,
  ChunkDefinition,
  ComponentGenerator,
  ProjectGeneratorOptions,
} from '@teleporthq/teleport-types'

import reactProjectMapping from './react-project-mapping.json'

export const createRouterIndexFile = async (root: ComponentUIDL) => {
  const routingComponentGenerator = createGenerator()
  routingComponentGenerator.addPlugin(reactAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  // React router is generated in index.js
  root.meta = root.meta || {}
  root.meta.fileName = 'index'

  const { files, dependencies } = await routingComponentGenerator.generateComponent(root)
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

export const createComponentGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const reactGenerator = createReactComponentGenerator('CSSModules')

  reactGenerator.addMapping(reactProjectMapping as Mapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  return reactGenerator
}
