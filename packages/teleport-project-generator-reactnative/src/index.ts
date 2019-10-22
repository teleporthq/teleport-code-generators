import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createReactNativeComponentGenerator } from '@teleporthq/teleport-component-generator-reactnative'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactNativeAppRoutingPlugin from '@teleporthq/teleport-plugin-reactnative-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'

import { Mapping } from '@teleporthq/teleport-types'

import ReactNativeProjectMapping from './reactnative-project-mapping.json'
import ReactNativeTemplate from './reactnative-project-template'

const createReactNativeProjectGenerator = () => {
  const reactComponentGenerator = createReactNativeComponentGenerator()
  reactComponentGenerator.addMapping(ReactNativeProjectMapping as Mapping)

  const reactPagesGenerator = createReactNativeComponentGenerator()
  reactPagesGenerator.addMapping(ReactNativeProjectMapping as Mapping)

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(reactNativeAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJSX)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: reactPagesGenerator,
      path: ['src', 'screens'],
    },
    router: {
      generator: routingComponentGenerator,
      path: ['src'],
      fileName: 'App',
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export { createReactNativeProjectGenerator, ReactNativeTemplate, ReactNativeProjectMapping }

export default createReactNativeProjectGenerator()
