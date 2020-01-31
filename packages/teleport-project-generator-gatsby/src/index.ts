import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import reactBasePlugin from '@teleporthq/teleport-plugin-react-base-component'
import { createCSSModulesPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createReactStyledComponentsPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import reactProptypes from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'

import { Mapping, ComponentPlugin, FileType, ReactStyleVariation } from '@teleporthq/teleport-types'

import GatsbyProjectMapping from './gatsby-mapping.json'
import GatsbyTemplate from './project-template'
import { createCustomHTMLEntryFile } from './utils'

const cssModulesPlugin = createCSSModulesPlugin({
  moduleExtension: true,
  camelCaseClassNames: true,
})
const styledComponentsPlugin = createReactStyledComponentsPlugin()

interface GatsbyProjectConfig {
  variation?: ReactStyleVariation
}

const createGatsbyProjectGenerator = (config?: GatsbyProjectConfig) => {
  const variation =
    config && config.variation && config.variation === ReactStyleVariation.StyledComponents
      ? ReactStyleVariation.StyledComponents
      : ReactStyleVariation.CSSModules
  const reactComponentGenerator = createCustomReactComponentGenerator(variation)
  const reactPagesGenerator = createCustomReactComponentGenerator(variation, [headConfigPlugin])

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(reactAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierJS)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: reactPagesGenerator,
      path: ['src', 'pages'],
      options: {
        useFileNameForNavigation: true,
      },
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['src'],
      fileName: 'html',
      chunkGenerationFunction: createCustomHTMLEntryFile,
    },
    static: {
      prefix: '',
      path: ['static'],
    },
    framework: {
      config: {
        fileName: 'gatsby-config',
        fileType: FileType.JS,
        configPath: [''],
        styleVariation: variation,
      },
    },
  })

  return generator
}

const createCustomReactComponentGenerator = (
  styleVariation: string,
  extraPlugins: ComponentPlugin[] = []
) => {
  const reactComponentGenerator = createComponentGenerator()
  reactComponentGenerator.addPlugin(reactBasePlugin)
  if (styleVariation === ReactStyleVariation.StyledComponents) {
    reactComponentGenerator.addPlugin(styledComponentsPlugin)
  } else {
    reactComponentGenerator.addPlugin(cssModulesPlugin)
  }
  reactComponentGenerator.addPlugin(reactProptypes)
  extraPlugins.forEach((plugin) => reactComponentGenerator.addPlugin(plugin))
  reactComponentGenerator.addPlugin(importStatementsPlugin)
  reactComponentGenerator.addMapping(GatsbyProjectMapping as Mapping)
  reactComponentGenerator.addPostProcessor(prettierJSX)
  return reactComponentGenerator
}

export { createGatsbyProjectGenerator, GatsbyProjectMapping, GatsbyTemplate }
