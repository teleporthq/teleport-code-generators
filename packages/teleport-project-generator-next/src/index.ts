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
import { createStateDataSourcePlugin } from './state-data-source-plugin'
import { NextProjectMapping } from './next-project-mapping'
import NextTemplate from './project-template'
import { createNextInternationalizationPlugin } from './internationalization/locale-mapper-component'
import { createNextUrlSearchParamsPlugin } from './url-search-params-plugin'
import { createNextLocaleFetcherPlugin } from './internationalization/locale-fetcher-component'
import { createNextFormSubmissionPlugin } from './forms/form-submission-handler'
import { NextDataSourceDependenciesPlugin } from './data-source-dependencies'
import { NextDataSourceUtilityPlugin } from './data-source-utility-plugin'
import {
  createNextWorkflowPlugin,
  NextWorkflowProjectPlugin,
} from '@teleporthq/teleport-plugin-next-workflows'
import { createNextGlobalStateComponentPlugin } from './global-state/component-plugin'
import { NextGlobalStateProjectPlugin } from './global-state/project-plugin'
import { NextAIChatProjectPlugin } from './ai-chat/project-plugin'
import { NextAnalyticsProjectPlugin } from './analytics/project-plugin'
import { NextEcommerceProjectPlugin } from './ecommerce/project-plugin'
import { NextDashboardLayoutPlugin } from './dashboard-layout-plugin'
import { NextRichTextEditorProjectPlugin } from './rich-text-editor/project-plugin'
import { createRichTextEditorComponentPlugin } from './rich-text-editor/component-plugin'
import { NextCalendarKitProjectPlugin } from './calendar/project-plugin'
import { NextDragDropProjectPlugin } from './drag-drop/project-plugin'
import { NextKanbanProjectPlugin } from './kanban/project-plugin'
import {
  createLocalComponentPathPlugin,
  INTERACTIVE_PRIMITIVE_COMPONENT_FILES,
} from './local-component-path-plugin'

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
  const stateDataSourcePlugin = createStateDataSourcePlugin()
  const nextInternationalizationPlugin = createNextInternationalizationPlugin()
  const nextUrlSearchParamsPlugin = createNextUrlSearchParamsPlugin()
  const nextLocaleFetcherPlugin = createNextLocaleFetcherPlugin()
  const nextFormSubmissionPlugin = createNextFormSubmissionPlugin()
  const dataSourceDependenciesPlugin = new NextDataSourceDependenciesPlugin()
  const dataSourceUtilityPlugin = new NextDataSourceUtilityPlugin()
  const nextComponentWorkflowPlugin = createNextWorkflowPlugin({ isPage: false })
  const nextPageWorkflowPlugin = createNextWorkflowPlugin({ isPage: true })
  const workflowProjectPlugin = new NextWorkflowProjectPlugin()
  const globalStateComponentPlugin = createNextGlobalStateComponentPlugin()
  const globalStateProjectPlugin = new NextGlobalStateProjectPlugin()
  const aiChatProjectPlugin = new NextAIChatProjectPlugin()
  const analyticsProjectPlugin = new NextAnalyticsProjectPlugin()
  const ecommerceProjectPlugin = new NextEcommerceProjectPlugin()
  const dashboardLayoutPlugin = new NextDashboardLayoutPlugin()
  const richTextEditorProjectPlugin = new NextRichTextEditorProjectPlugin()
  const calendarKitProjectPlugin = new NextCalendarKitProjectPlugin()
  const dragDropProjectPlugin = new NextDragDropProjectPlugin()
  const kanbanProjectPlugin = new NextKanbanProjectPlugin()
  const localPrimitivesPagePlugin = createLocalComponentPathPlugin({
    basePath: ['pages'],
    componentFiles: INTERACTIVE_PRIMITIVE_COMPONENT_FILES,
  })
  const localPrimitivesComponentPlugin = createLocalComponentPathPlugin({
    basePath: ['components'],
    componentFiles: INTERACTIVE_PRIMITIVE_COMPONENT_FILES,
  })
  const richTextEditorPagePlugin = createRichTextEditorComponentPlugin({ basePath: ['pages'] })
  const richTextEditorComponentPlugin = createRichTextEditorComponentPlugin({
    basePath: ['components'],
  })

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
        nextUrlSearchParamsPlugin,
        nextFormSubmissionPlugin,
        nextComponentWorkflowPlugin,
        globalStateComponentPlugin,
        richTextEditorComponentPlugin,
        localPrimitivesComponentPlugin,
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
        nextUrlSearchParamsPlugin,
        nextPageInlineFetchPlugin,
        nextPagesDataSourcePlugin,
        stateDataSourcePlugin,
        nextLocaleFetcherPlugin,
        nextFormSubmissionPlugin,
        nextPageWorkflowPlugin,
        globalStateComponentPlugin,
        richTextEditorPagePlugin,
        localPrimitivesPagePlugin,
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

  generator.addPlugin(dataSourceDependenciesPlugin)
  generator.addPlugin(dataSourceUtilityPlugin)
  generator.addPlugin(workflowProjectPlugin)
  generator.addPlugin(ecommerceProjectPlugin)
  generator.addPlugin(globalStateProjectPlugin)
  generator.addPlugin(aiChatProjectPlugin)
  generator.addPlugin(analyticsProjectPlugin)
  generator.addPlugin(dashboardLayoutPlugin)
  generator.addPlugin(richTextEditorProjectPlugin)
  generator.addPlugin(calendarKitProjectPlugin)
  generator.addPlugin(dragDropProjectPlugin)
  generator.addPlugin(kanbanProjectPlugin)

  return generator
}

export { createNextProjectGenerator, NextProjectMapping, NextTemplate }
export { createNextGlobalStateComponentPlugin } from './global-state/component-plugin'
export { NextGlobalStateProjectPlugin } from './global-state/project-plugin'
export { NextAIChatProjectPlugin } from './ai-chat/project-plugin'
export { NextAnalyticsProjectPlugin } from './analytics/project-plugin'
export { NextEcommerceProjectPlugin } from './ecommerce/project-plugin'
export { NextDashboardLayoutPlugin } from './dashboard-layout-plugin'
export { NextRichTextEditorProjectPlugin } from './rich-text-editor/project-plugin'
export { createRichTextEditorComponentPlugin } from './rich-text-editor/component-plugin'
export { NextCalendarKitProjectPlugin } from './calendar/project-plugin'
export { CALENDARKIT_CSS, CALENDARKIT_VERSION } from './calendar/calendarkit-css'
export { NextDragDropProjectPlugin } from './drag-drop/project-plugin'
export { NextKanbanProjectPlugin } from './kanban/project-plugin'
export { generateDragDropComponentCode } from './drag-drop/component-generator'
export { generateKanbanComponentCode } from './kanban/component-generator'
export {
  createLocalComponentPathPlugin,
  INTERACTIVE_PRIMITIVE_COMPONENT_FILES,
} from './local-component-path-plugin'
export { NextFormsCaptchaScriptPlugin } from './forms/captcha-script-plugin'
export { NextProjectPlugini18nConfig } from './internationalization/project'
export { NextDataSourceDependenciesPlugin } from './data-source-dependencies'
export { NextDataSourceUtilityPlugin } from './data-source-utility-plugin'
export { NextWorkflowProjectPlugin } from '@teleporthq/teleport-plugin-next-workflows'
export { createNextLocaleFetcherPlugin } from './internationalization/locale-fetcher-component'
export { createNextInternationalizationPlugin } from './internationalization/locale-mapper-component'
export { createNextFormSubmissionPlugin } from './forms/form-submission-handler'
export {
  createNextPagesDataSourcePlugin,
  createNextComponentDataSourcePlugin,
} from '@teleporthq/teleport-plugin-next-data-source'
export { createNextPartialGenerator } from './partial'
export type {
  NextPartialGeneratorOptions,
  PartialGenerationResult,
  FrameworkConfigInput,
} from './partial'
export { splitProjectUIDL } from './split-utils'
export type { SplitProjectResult } from './split-utils'
