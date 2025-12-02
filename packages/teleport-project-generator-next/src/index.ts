import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import nextImagePlugin from '@teleporthq/teleport-plugin-jsx-next-image'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createJSXHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import { createStaticPropsPlugin } from '@teleporthq/teleport-plugin-next-static-props'
import { createStaticPathsPlugin } from '@teleporthq/teleport-plugin-next-static-paths'
import {
  createNextPagesInlineFetchPlugin,
  createNextComponentInlineFetchPlugin,
} from '@teleporthq/teleport-plugin-next-inline-fetch'
import {
  createNextPagesDataSourcePlugin,
  createNextComponentDataSourcePlugin,
} from '@teleporthq/teleport-plugin-next-data-source'
import { ReactStyleVariation, FileType } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { createDocumentFileChunks, configContentGenerator } from './utils'
import { NextProjectMapping } from './next-project-mapping'
import NextTemplate from './project-template'
import { createNextInternationalizationPlugin } from './internationalization/locale-mapper-component'
import { createNextLocaleFetcherPlugin } from './internationalization/locale-fetcher-component'
import { createNextFormSubmissionPlugin } from './forms/form-submission-handler'
import { NextDataSourceDependenciesPlugin } from './data-source-dependencies'

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
  const nextComponentInlineFetchPlugin = createNextComponentInlineFetchPlugin()
  const nextPageInlineFetchPlugin = createNextPagesInlineFetchPlugin()
  const nextComponentDataSourcePlugin = createNextComponentDataSourcePlugin()
  const nextPagesDataSourcePlugin = createNextPagesDataSourcePlugin()
  const nextInternationalizationPlugin = createNextInternationalizationPlugin()
  const nextLocaleFetcherPlugin = createNextLocaleFetcherPlugin()
  const nextFormSubmissionPlugin = createNextFormSubmissionPlugin()
  const dataSourceDependenciesPlugin = new NextDataSourceDependenciesPlugin()

  const generator = createProjectGenerator({
    id: 'teleport-project-next',
    style: ReactStyleVariation.StyledJSX,
    components: {
      generator: createReactComponentGenerator,
      plugins: [
        nextImagePlugin,
        nextComponentInlineFetchPlugin,
        nextComponentDataSourcePlugin,
        nextInternationalizationPlugin,
        nextFormSubmissionPlugin,
      ],
      mappings: [NextProjectMapping],
      path: ['components'],
    },
    pages: {
      generator: createReactComponentGenerator,
      path: ['pages'],
      plugins: [
        nextImagePlugin,
        headConfigPlugin,
        getStaticPropsPlugin,
        getStaticPathsPlugin,
        nextInternationalizationPlugin,
        nextPageInlineFetchPlugin,
        nextPagesDataSourcePlugin,
        nextLocaleFetcherPlugin,
        nextFormSubmissionPlugin,
        importStatementsPlugin,
      ],
      mappings: [NextProjectMapping],
      options: {
        useFileNameForNavigation: true,
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
    resources: {
      path: ['resources'],
    },
    static: {
      prefix: '',
      path: ['public'],
    },
  })

  // Add data source dependencies plugin to handle package.json dependencies
  generator.addPlugin(dataSourceDependenciesPlugin)

  return generator
}

export { createNextProjectGenerator, NextProjectMapping, NextTemplate }
export { NextFormsCaptchaScriptPlugin } from './forms/captcha-script-plugin'
export { NextProjectPlugini18nConfig } from './internationalization/project'
export { NextDataSourceDependenciesPlugin } from './data-source-dependencies'
export { createNextLocaleFetcherPlugin } from './internationalization/locale-fetcher-component'
export { createNextInternationalizationPlugin } from './internationalization/locale-mapper-component'
export { createNextFormSubmissionPlugin } from './forms/form-submission-handler'
export {
  createNextPagesDataSourcePlugin,
  createNextComponentDataSourcePlugin,
} from '@teleporthq/teleport-plugin-next-data-source'
