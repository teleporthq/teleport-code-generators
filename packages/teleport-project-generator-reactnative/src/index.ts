import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createReactNativeComponentGenerator } from '@teleporthq/teleport-component-generator-reactnative'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactNativeAppRoutingPlugin from '@teleporthq/teleport-plugin-reactnative-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'

import { ReactNativeProjectMapping } from './reactnative-project-mapping'
import ReactNativeTemplate from './reactnative-project-template'

const createReactNativeProjectGenerator = () => {
  const generator = createProjectGenerator({
    id: 'teleport-project-react-native',
    components: {
      generator: createReactNativeComponentGenerator,
      mappings: [ReactNativeProjectMapping],
      path: ['src', 'components'],
    },
    pages: {
      generator: createReactNativeComponentGenerator,
      mappings: [ReactNativeProjectMapping],
      path: ['src', 'screens'],
    },
    router: {
      generator: createComponentGenerator,
      plugins: [reactNativeAppRoutingPlugin, importStatementsPlugin],
      postprocessors: [prettierJSX],
      path: ['src'],
      fileName: 'App',
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin(), importStatementsPlugin],
      fileName: 'style',
      path: ['src'],
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
