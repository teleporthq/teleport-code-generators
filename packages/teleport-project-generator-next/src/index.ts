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
import { ReactStyleVariation, FileType, ProjectPlugin } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { createDocumentFileChunks, configContentGenerator } from './utils'
import { createStateDataSourcePlugin } from './state-data-source-plugin'
import { NextProjectMapping } from './next-project-mapping'
import NextTemplate from './project-template'
import { createNextInternationalizationPlugin } from './internationalization/locale-mapper-component'
import { createAIChatLocalizedWelcomePlugin } from './ai-chat/component-plugin'
import { createAIChatMarkdownStylesPlugin } from './ai-chat/markdown-styles-plugin'
import { createAIChatOptionChipsStylesPlugin } from './ai-chat/option-chips-styles-plugin'
import { createAIChatSessionPersistencePlugin } from './ai-chat/session-persistence-plugin'
import { createNextUrlSearchParamsPlugin } from './url-search-params-plugin'
import { createNextLocaleFetcherPlugin } from './internationalization/locale-fetcher-component'
import { createNextFormSubmissionPlugin } from './forms/form-submission-handler'
import { NextDataSourceDependenciesPlugin } from './data-source-dependencies'
import { NextCacheRuntimePlugin } from './cache/project-plugin'
import { NextDataSourceUtilityPlugin } from './data-source-utility-plugin'
import {
  createNextWorkflowPlugin,
  NextWorkflowProjectPlugin,
} from '@teleporthq/teleport-plugin-next-workflows'
import { createNextGlobalStateComponentPlugin } from './global-state/component-plugin'
import { NextGlobalStateProjectPlugin } from './global-state/project-plugin'
import { NextAIChatProjectPlugin } from './ai-chat/project-plugin'
import { NextAnalyticsProjectPlugin } from './analytics/project-plugin'
import { NextNavActiveLinkProjectPlugin } from './nav-active-link/project-plugin'
import { NextCollapsibleTextProjectPlugin } from './collapsible-text/project-plugin'
import { NextEcommerceProjectPlugin } from './ecommerce/project-plugin'
import { NextDashboardLayoutPlugin } from './dashboard-layout-plugin'
import { createEntityMutationSsrFinalizerPlugin } from './entity-mutation-ssr-finalize-plugin'
import { NextRichTextEditorProjectPlugin } from './rich-text-editor/project-plugin'
import { createRichTextEditorComponentPlugin } from './rich-text-editor/component-plugin'
import { NextCalendarKitProjectPlugin } from './calendar/project-plugin'
import { NextDragDropProjectPlugin } from './drag-drop/project-plugin'
import { NextKanbanProjectPlugin } from './kanban/project-plugin'
import { NextCountdownProjectPlugin } from './countdown/project-plugin'
import { NextModelViewerProjectPlugin } from './model-viewer/project-plugin'
import { NextPlaySoundProjectPlugin } from './play-sound/project-plugin'
import { NextPaginationScrollProjectPlugin } from './pagination-scroll/project-plugin'
import { createNextWidgetProjectPlugins } from './widgets'
import {
  createLocalComponentPathPlugin,
  INTERACTIVE_PRIMITIVE_COMPONENT_FILES,
} from './local-component-path-plugin'

/**
 * The ordered list of Next.js PROJECT-level plugins (the ones added via
 * `generator.addPlugin`). This is the SINGLE SOURCE OF TRUTH shared by
 * `createNextProjectGenerator` (below) and `packProject` in
 * `@teleporthq/teleport-code-generator`.
 *
 * `packProject` calls `cleanPlugins()` and rebuilds the project's plugin list
 * from scratch, so historically this list was duplicated there by hand. The two
 * copies drifted: a plugin registered here but missing from packProject's copy
 * (or lost to a stale build of that package) was silently dropped at generation
 * time. The visible symptom was a generated project that imports an npm package —
 * e.g. `framer-motion` from `components/tq-motion.js`, or the calendar/kanban
 * wrappers — that was never written into `package.json`, so `next build` failed
 * with "Module not found: Can't resolve 'framer-motion'".
 *
 * Defining the list once here makes that class of bug structurally impossible:
 * adding a new project plugin in this array automatically reaches BOTH the
 * standalone generator and packProject. Each call returns fresh plugin instances
 * (packProject re-invokes it after cleanPlugins()).
 *
 * NOTE: this intentionally excludes the few packProject-only plugins that need
 * runtime options (i18n sitemap config, forms-captcha script, cross-framework
 * i18n files); those remain in packProject.
 */
export const createNextProjectPlugins = (): ProjectPlugin[] => [
  new NextDataSourceDependenciesPlugin(),
  new NextCacheRuntimePlugin(),
  new NextDataSourceUtilityPlugin(),
  new NextWorkflowProjectPlugin(),
  new NextEcommerceProjectPlugin(),
  new NextGlobalStateProjectPlugin(),
  new NextAIChatProjectPlugin(),
  new NextAnalyticsProjectPlugin(),
  new NextNavActiveLinkProjectPlugin(),
  new NextCollapsibleTextProjectPlugin(),
  new NextDashboardLayoutPlugin(),
  new NextRichTextEditorProjectPlugin(),
  new NextCalendarKitProjectPlugin(),
  new NextDragDropProjectPlugin(),
  new NextKanbanProjectPlugin(),
  new NextCountdownProjectPlugin(),
  new NextModelViewerProjectPlugin(),
  new NextPlaySoundProjectPlugin(),
  new NextPaginationScrollProjectPlugin(),
  ...createNextWidgetProjectPlugins(),
]

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
  const aiChatSessionPersistencePlugin = createAIChatSessionPersistencePlugin({
    basePath: ['components'],
  })
  const aiChatLocalizedWelcomePlugin = createAIChatLocalizedWelcomePlugin({
    basePath: ['components'],
  })
  const aiChatMarkdownStylesPlugin = createAIChatMarkdownStylesPlugin()
  const aiChatOptionChipsStylesPlugin = createAIChatOptionChipsStylesPlugin()
  const nextUrlSearchParamsPlugin = createNextUrlSearchParamsPlugin()
  const nextLocaleFetcherPlugin = createNextLocaleFetcherPlugin()
  const nextFormSubmissionPlugin = createNextFormSubmissionPlugin()
  const nextComponentWorkflowPlugin = createNextWorkflowPlugin({ isPage: false })
  const nextPageWorkflowPlugin = createNextWorkflowPlugin({ isPage: true })
  const globalStateComponentPlugin = createNextGlobalStateComponentPlugin()
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
  const entityMutationSsrFinalizerPlugin = createEntityMutationSsrFinalizerPlugin()

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
        // Chat-only: keeps the transcript alive across client-side
        // navigation. MUST run before the welcome plugin, so a restored
        // transcript still gets its greeting re-localized.
        aiChatSessionPersistencePlugin,
        // Runs on the ai-assistant-chat component only — see its own note for
        // why the welcome message cannot go through the locale mapper above.
        aiChatLocalizedWelcomePlugin,
        // Also chat-only: appends descendant CSS for the runtime markdown
        // children (links, lists, bold) the per-node UIDL styles cannot reach.
        aiChatMarkdownStylesPlugin,
        // Chat-only: the answer-chip states (`selected` / `inactive` /
        // disabled) live in a data attribute the chat's scripts write, and an
        // attribute selector cannot be expressed as a per-node UIDL style.
        aiChatOptionChipsStylesPlugin,
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
        // Must run AFTER every plugin above that fetches/merges data into the
        // 'getStaticProps' chunk by that literal name (inline-fetch,
        // data-source, state-data-source, locale-fetcher already ran by this
        // point) — see entity-mutation-ssr-finalize-plugin.ts for why the
        // rename can't happen any earlier.
        entityMutationSsrFinalizerPlugin,
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

  // Single source of truth for the Next.js PROJECT-level plugins — see
  // createNextProjectPlugins. packProject (in @teleporthq/teleport-code-generator)
  // reuses the exact same list, so the two can never drift.
  createNextProjectPlugins().forEach((plugin) => generator.addPlugin(plugin))

  return generator
}

export { createNextProjectGenerator, NextProjectMapping, NextTemplate }
export { createNextGlobalStateComponentPlugin } from './global-state/component-plugin'
export { NextGlobalStateProjectPlugin } from './global-state/project-plugin'
export { NextAIChatProjectPlugin } from './ai-chat/project-plugin'
export { createAIChatLocalizedWelcomePlugin } from './ai-chat/component-plugin'
export { createAIChatMarkdownStylesPlugin } from './ai-chat/markdown-styles-plugin'
export { createAIChatOptionChipsStylesPlugin } from './ai-chat/option-chips-styles-plugin'
export { createAIChatSessionPersistencePlugin } from './ai-chat/session-persistence-plugin'
export { NextAnalyticsProjectPlugin } from './analytics/project-plugin'
export { NextEcommerceProjectPlugin } from './ecommerce/project-plugin'
export { NextDashboardLayoutPlugin } from './dashboard-layout-plugin'
export { createEntityMutationSsrFinalizerPlugin } from './entity-mutation-ssr-finalize-plugin'
export { NextRichTextEditorProjectPlugin } from './rich-text-editor/project-plugin'
export { createRichTextEditorComponentPlugin } from './rich-text-editor/component-plugin'
export { NextCalendarKitProjectPlugin } from './calendar/project-plugin'
export { CALENDARKIT_CSS, CALENDARKIT_VERSION } from './calendar/calendarkit-css'
export { NextDragDropProjectPlugin } from './drag-drop/project-plugin'
export { NextKanbanProjectPlugin } from './kanban/project-plugin'
export { NextCountdownProjectPlugin } from './countdown/project-plugin'
// Re-exported so `packProject` (in @teleporthq/teleport-code-generator) can re-add
// the npm-backed widget primitives after it calls cleanPlugins(); the plugins
// registered inside createNextProjectGenerator are wiped by that path.
export { createNextWidgetProjectPlugins } from './widgets'
export { generateDragDropComponentCode } from './drag-drop/component-generator'
export { generateKanbanComponentCode } from './kanban/component-generator'
export { generateCountdownComponentCode } from './countdown/component-generator'
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
