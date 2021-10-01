import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactBasePlugin from '@teleporthq/teleport-plugin-react-base-component'
import {
  GatsbyStyleVariation,
  ComponentGenerator,
  TeleportError,
  ComponentGeneratorInstance,
  GeneratorFactoryParams,
  FileType,
} from '@teleporthq/teleport-types'
import {
  createCSSModulesPlugin,
  createStyleSheetPlugin,
} from '@teleporthq/teleport-plugin-css-modules'
import reactStyledComponentsPlugin from '@teleporthq/teleport-plugin-react-styled-components'
import reactProptypes from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'
import { GatsbyProjectMapping } from './gatsby-project-mapping'
import GatsbyTemplate from './project-template'
import { createCustomHTMLEntryFile, styleSheetDependentConfigGenerator } from './utils'

const createGatsbyProjectGenerator = () => {
  const generator = createProjectGenerator({
    id: 'teleport-project-gatsby',
    components: {
      generator: createCustomReactGatsbyComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: createCustomReactGatsbyComponentGenerator,
      path: ['src', 'pages'],
      plugins: [headConfigPlugin],
      options: {
        useFileNameForNavigation: true,
      },
    },
    entry: {
      postprocessors: [prettierJS],
      path: ['src'],
      fileName: 'html',
      chunkGenerationFunction: createCustomHTMLEntryFile,
    },
    static: {
      prefix: '',
      path: ['static'],
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin({ moduleExtension: true })],
      fileName: 'style',
      path: ['src'],
      importFile: true,
    },
    framework: {
      config: {
        fileName: 'gatsby-browser',
        fileType: FileType.JS,
        path: [''],
        generator: createComponentGenerator,
        plugins: [importStatementsPlugin],
        postprocessors: [prettierJS],
        configContentGenerator: styleSheetDependentConfigGenerator,
        isGlobalStylesDependent: true,
      },
    },
  })

  return generator
}

const createCustomReactGatsbyComponentGenerator: ComponentGeneratorInstance = ({
  mappings = [],
  plugins = [],
  postprocessors = [],
  variation = GatsbyStyleVariation.CSSModules,
}: GeneratorFactoryParams): ComponentGenerator => {
  const cssModulesPlugin = createCSSModulesPlugin({
    moduleExtension: true,
  })
  const stylePlugins = {
    [GatsbyStyleVariation.StyledComponents]: reactStyledComponentsPlugin,
    [GatsbyStyleVariation.CSSModules]: cssModulesPlugin,
  }

  const stylePlugin = stylePlugins[variation as GatsbyStyleVariation]
  if (!stylePlugin) {
    throw new TeleportError(`Un-supported style flavour selected - ${variation}`)
  }

  const reactComponentGenerator = createComponentGenerator()

  mappings.forEach((mapping) => reactComponentGenerator.addMapping(mapping))
  reactComponentGenerator.addPlugin(reactBasePlugin)
  reactComponentGenerator.addPlugin(reactProptypes)
  reactComponentGenerator.addPlugin(stylePlugin)

  plugins.forEach((plugin) => reactComponentGenerator.addPlugin(plugin))

  reactComponentGenerator.addPlugin(importStatementsPlugin)
  reactComponentGenerator.addMapping(GatsbyProjectMapping)
  reactComponentGenerator.addPostProcessor(prettierJSX)
  postprocessors.forEach((postprocessor) => reactComponentGenerator.addPostProcessor(postprocessor))
  return reactComponentGenerator
}

export {
  createGatsbyProjectGenerator,
  GatsbyProjectMapping,
  GatsbyTemplate,
  createCustomReactGatsbyComponentGenerator,
}
