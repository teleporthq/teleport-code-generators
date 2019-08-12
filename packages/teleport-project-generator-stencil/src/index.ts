import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createPlugin as createRouterPlugin } from '@teleporthq/teleport-plugin-react-app-routing'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import stencilProjectMapping from './stencil-mapping.json'

export const createStencilProjectGenerator = () => {
  const stencilComponentGenerator = createStencilComponentGenerator()
  stencilComponentGenerator.addMapping(stencilProjectMapping as Mapping)

  const routerPlugin = createRouterPlugin({ flavor: 'stencil' })
  const routingComponentGenerator = createStencilComponentGenerator()
  routingComponentGenerator.addPlugin(routerPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: stencilComponentGenerator,
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    pages: {
      generator: stencilComponentGenerator,
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    router: {
      generator: routingComponentGenerator,
      path: ['src', 'components'],
      fileName: 'app',
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['src'],
      fileName: 'index',
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export default createStencilProjectGenerator()
