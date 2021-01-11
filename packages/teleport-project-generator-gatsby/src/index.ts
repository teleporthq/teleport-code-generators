import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import reactBasePlugin from '@teleporthq/teleport-plugin-react-base-component'
import {
  createCSSModulesPlugin,
  createStyleSheetPlugin,
} from '@teleporthq/teleport-plugin-css-modules'
import {
  createReactStyledComponentsPlugin,
  createStyleSheetPlugin as createStyledComponentsStyleSheetPlugin,
} from '@teleporthq/teleport-plugin-react-styled-components'
import reactProptypes from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'

import {
  Mapping,
  ComponentPlugin,
  FileType,
  ReactStyleVariation,
  ProjectStrategy,
} from '@teleporthq/teleport-types'

import GatsbyProjectMapping from './gatsby-mapping.json'
import GatsbyTemplate from './project-template'
import {
  createCustomHTMLEntryFile,
  appendToConfigFile,
  styleSheetDependentConfigGenerator,
} from './utils'

const cssModulesPlugin = createCSSModulesPlugin({
  moduleExtension: true,
  camelCaseClassNames: true,
})
const styledComponentsPlugin = createReactStyledComponentsPlugin()

interface GatsbyProjectConfig {
  variation?: ReactStyleVariation
}

const createGatsbyProjectGenerator = (config?: GatsbyProjectConfig) => {
  const variation = config?.variation || ReactStyleVariation.CSSModules
  const reactComponentGenerator = createCustomReactComponentGenerator(variation)
  const reactPagesGenerator = createCustomReactComponentGenerator(variation, [headConfigPlugin])

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(reactAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierJS)

  const configGenerator = createComponentGenerator()
  configGenerator.addPlugin(importStatementsPlugin)
  configGenerator.addPostProcessor(prettierJS)

  const styleSheetGenerator = createComponentGenerator()
  if (variation === ReactStyleVariation.StyledComponents) {
    styleSheetGenerator.addPlugin(createStyledComponentsStyleSheetPlugin())
    styleSheetGenerator.addPlugin(importStatementsPlugin)
    styleSheetGenerator.addPostProcessor(prettierJS)
  } else {
    styleSheetGenerator.addPlugin(createStyleSheetPlugin({ moduleExtension: true }))
  }

  const strategy: ProjectStrategy = {
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
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['src'],
      importFile: true,
    },
  }

  if (variation === ReactStyleVariation.CSSModules) {
    strategy.framework = {
      config: {
        fileName: 'gatsby-browser',
        fileType: FileType.JS,
        path: [''],
        generator: configGenerator,
        configContentGenerator: styleSheetDependentConfigGenerator,
        isGlobalStylesDependent: true,
      },
    }
  }

  if (variation === ReactStyleVariation.StyledComponents) {
    strategy.framework = {
      replace: {
        fileName: 'gatsby-config',
        fileType: FileType.JS,
        path: [''],
        replaceFile: appendToConfigFile,
      },
    }
  }

  const generator = createProjectGenerator(strategy)

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
