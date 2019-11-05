import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import createExportComponentsPlugin from '@teleporthq/teleport-plugin-export-components'

import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { ReactStyleVariation } from '@teleporthq/teleport-types'

import SlidesTemplate from './slides-template'

const slidesGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.CSSModules)

  const exportComponentsGenerator = createComponentGenerator()
  exportComponentsGenerator.addPlugin(createExportComponentsPlugin)
  exportComponentsGenerator.addPostProcessor(prettierJS)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['src', 'slides'],
      options: {
        exportAllComponents: exportComponentsGenerator,
      },
    },
    static: {
      prefix: '',
      path: ['assets'],
    },
  })

  return generator
}

export { slidesGenerator, SlidesTemplate }
