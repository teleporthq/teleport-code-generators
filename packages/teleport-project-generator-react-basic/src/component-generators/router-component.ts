import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createGenerator } from '@teleporthq/teleport-component-generator'

import htmlMapping from './html-mapping.json'
import reactMapping from './react-mapping.json'

import { ComponentGenerator } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

export const createReactRouterGenerator = (): ComponentGenerator => {
  const generator = createGenerator()

  generator.addMapping(htmlMapping as Mapping)
  generator.addMapping(reactMapping)

  generator.addPlugin(reactAppRoutingPlugin)
  generator.addPlugin(importStatementsPlugin)

  generator.addPostProcessor(prettierJS)

  return generator
}

export default createReactRouterGenerator
