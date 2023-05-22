import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import nextImagePlugin from '@teleporthq/teleport-plugin-jsx-next-image'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createJSXHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import { createStaticPropsPlugin } from '@teleporthq/teleport-plugin-next-static-props'
import { createStaticPathsPlugin } from '@teleporthq/teleport-plugin-next-static-paths'
import { ReactStyleVariation, FileType, ProjectType } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { ProjectPluginContexts } from '@teleporthq/teleport-project-plugin-contexts'
import { createDocumentFileChunks, configContentGenerator } from './utils'
import { NextProjectMapping } from './next-project-mapping'
import NextTemplate from './project-template'
import { createNextContextPlugin } from '@teleporthq/teleport-plugin-next-context'
import { createNextComponentCMSFetchPlugin } from '@teleporthq/teleport-plugin-next-cms-fetch'
import { ProjectPluginApiRoutes } from '@teleporthq/teleport-project-plugin-api-routes'

const createNextProjectGenerator = () => {
  const headConfigPlugin = createJSXHeadConfigPlugin({
    configTagIdentifier: 'Head',
    configTagDependencyPath: 'next/head',
    isExternalPackage: false,
    isDefaultImport: true,
  })
  const styleSheetPlugin = createStyleSheetPlugin({
    fileName: 'style',
  })

  const getStaticPropsPlugin = createStaticPropsPlugin()
  const getStaticPathsPlugin = createStaticPathsPlugin()
  const contextPlugin = createNextContextPlugin()
  const nextComponentCMSFetchPlugin = createNextComponentCMSFetchPlugin()

  const generator = createProjectGenerator({
    id: 'teleport-project-next',
    style: ReactStyleVariation.StyledJSX,
    components: {
      generator: createReactComponentGenerator,
      plugins: [nextImagePlugin, nextComponentCMSFetchPlugin, contextPlugin],
      mappings: [NextProjectMapping],
      path: ['components'],
    },
    pages: {
      generator: createReactComponentGenerator,
      path: ['pages'],
      plugins: [
        nextImagePlugin,
        headConfigPlugin,
        nextComponentCMSFetchPlugin,
        getStaticPathsPlugin,
        getStaticPropsPlugin,
        contextPlugin,
      ],
      mappings: [NextProjectMapping],
      options: {
        useFileNameForNavigation: true,
        customComponentFileName(name, options) {
          if (options?.isIndex) {
            return 'index'
          }

          if (options?.dynamicRouteAttribute) {
            return `[${options.dynamicRouteAttribute}]`
          }

          return name
        },
      },
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [styleSheetPlugin],
      fileName: 'style',
      path: ['pages'],
    },
    entry: {
      postprocessors: [prettierJS],
      path: ['pages'],
      fileName: '_document',
      chunkGenerationFunction: createDocumentFileChunks,
    },
    framework: {
      config: {
        fileName: `_app`,
        fileType: FileType.JS,
        path: ['pages'],
        generator: createComponentGenerator,
        plugins: [importStatementsPlugin],
        postprocessors: [prettierJS],
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

  generator.addPlugin(new ProjectPluginContexts({ framework: ProjectType.NEXT }))
  generator.addPlugin(new ProjectPluginApiRoutes({ framework: ProjectType.NEXT }))

  return generator
}

export { createNextProjectGenerator, NextProjectMapping, NextTemplate }
