import {
  PackProjectFunction,
  GenerateComponentFunction,
  ComponentUIDL,
  PublisherType,
  ProjectType,
  ComponentType,
  StyleVariation,
  ReactStyleVariation,
  InvalidProjectTypeError,
  InvalidPublisherTypeError,
  GeneratorOptions,
  Mapping,
  ComponentGenerator,
  ComponentGeneratorInstance,
  ProjectPlugin,
  HTMLComponentGenerator,
  ComponentPlugin,
} from '@teleporthq/teleport-types'
import { Constants } from '@teleporthq/teleport-shared'

import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import {
  ReactTemplate,
  createReactProjectGenerator,
  ReactProjectMapping,
} from '@teleporthq/teleport-project-generator-react'
import {
  createNextProjectGenerator,
  NextTemplate,
  NextProjectPlugini18nConfig,
  NextFormsCaptchaScriptPlugin,
  NextDataSourceDependenciesPlugin,
  NextDataSourceUtilityPlugin,
  NextWorkflowProjectPlugin,
  NextRichTextEditorProjectPlugin,
  NextEcommerceProjectPlugin,
  NextGlobalStateProjectPlugin,
  NextAIChatProjectPlugin,
  NextAnalyticsProjectPlugin,
  NextDashboardLayoutPlugin,
  NextCalendarKitProjectPlugin,
  NextDragDropProjectPlugin,
  NextKanbanProjectPlugin,
  NextCountdownProjectPlugin,
  createNextWidgetProjectPlugins,
} from '@teleporthq/teleport-project-generator-next'
import {
  VueTemplate,
  createVueProjectGenerator,
  VueProjectMapping,
} from '@teleporthq/teleport-project-generator-vue'
import {
  NuxtTemplate,
  createNuxtProjectGenerator,
  nuxtErrorPageMapper,
} from '@teleporthq/teleport-project-generator-nuxt'

import {
  createAngularProjectGenerator,
  AngularTemplate,
  AngularProjectMapping,
} from '@teleporthq/teleport-project-generator-angular'

import {
  createHTMLProjectGenerator,
  HTMLTemplate,
  pluginHomeReplace,
  htmlErrorPageMapping,
  ProjectPluginCloneGlobals,
} from '@teleporthq/teleport-project-generator-html'

import { createZipPublisher } from '@teleporthq/teleport-publisher-zip'
import { createVercelPublisher } from '@teleporthq/teleport-publisher-vercel'
import { createNetlifyPublisher } from '@teleporthq/teleport-publisher-netlify'
import { createGithubPublisher } from '@teleporthq/teleport-publisher-github'
import { createCodesandboxPublisher } from '@teleporthq/teleport-publisher-codesandbox'

import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
import {
  createHTMLComponentGenerator,
  PlainHTMLMapping,
} from '@teleporthq/teleport-component-generator-html'
import { ProjectPlugini18nFiles } from '@teleporthq/teleport-project-plugin-i18n-files'
import { isNodeProcess } from './utils'

const componentGeneratorFactories: Record<ComponentType, ComponentGeneratorInstance> = {
  [ComponentType.REACT]: createReactComponentGenerator,
  [ComponentType.ANGULAR]: createAngularComponentGenerator,
  [ComponentType.VUE]: createVueComponentGenerator,
  [ComponentType.HTML]: createHTMLComponentGenerator,
}

const componentGeneratorProjectMappings = {
  [ComponentType.REACT]: ReactProjectMapping,
  [ComponentType.ANGULAR]: AngularProjectMapping,
  [ComponentType.VUE]: VueProjectMapping,
  [ComponentType.HTML]: PlainHTMLMapping,
}

const projectGeneratorFactories = {
  [ProjectType.REACT]: createReactProjectGenerator,
  [ProjectType.NEXT]: createNextProjectGenerator,
  [ProjectType.VUE]: createVueProjectGenerator,
  [ProjectType.NUXT]: createNuxtProjectGenerator,
  [ProjectType.ANGULAR]: createAngularProjectGenerator,
  [ProjectType.HTML]: createHTMLProjectGenerator,
}

const templates = {
  [ProjectType.REACT]: ReactTemplate,
  [ProjectType.NEXT]: NextTemplate,
  [ProjectType.VUE]: VueTemplate,
  [ProjectType.NUXT]: NuxtTemplate,
  [ProjectType.ANGULAR]: AngularTemplate,
  [ProjectType.HTML]: HTMLTemplate,
}

/* tslint:disable ban-types */
const projectPublisherFactories: Omit<Record<PublisherType, Function>, PublisherType.DISK> = {
  [PublisherType.ZIP]: createZipPublisher,
  [PublisherType.VERCEL]: createVercelPublisher,
  [PublisherType.NETLIFY]: createNetlifyPublisher,
  [PublisherType.GITHUB]: createGithubPublisher,
  [PublisherType.CODESANDBOX]: createCodesandboxPublisher,
}

export const packProject: PackProjectFunction = async (
  projectUIDL,
  {
    projectType,
    publisher: publisherType,
    publishOptions = {},
    assets = [],
    plugins = [],
    assetsFolder = [Constants.ASSETS_IDENTIFIER],
    excludeGlobalsFromHTMLComponents,
    strictHtmlWhitespaceSensitivity = true,
    standaloneHtmlComponents = false,
    excludeHtmlComponentFiles = false,
    generateSitemap = true,
    targetLocale,
  }
) => {
  // When standaloneHtmlComponents is true, components should be self-contained fragments
  // without DOCTYPE/html/head wrapper. Automatically enable excludeGlobalsFromHTMLComponents
  // unless explicitly set to false by the user.
  const shouldExcludeGlobals =
    excludeGlobalsFromHTMLComponents ?? (standaloneHtmlComponents ? true : false)
  // When standaloneHtmlComponents is true, pages inline all sub-components, so separate
  // component files are redundant. Automatically enable excludeHtmlComponentFiles unless
  // explicitly set by the user.
  const shouldexcludeHtmlComponentFiles =
    excludeHtmlComponentFiles ?? (standaloneHtmlComponents ? true : false)
  const packer = createProjectPacker()
  let publisher
  if (publisherType === PublisherType.DISK) {
    if (isNodeProcess()) {
      const createDiskPublisher = await import('@teleporthq/teleport-publisher-disk').then(
        (mod) => mod.createDiskPublisher
      )
      publisher = createDiskPublisher
    } else {
      throw Error(`${PublisherType.DISK} can only be used inside node environments`)
    }
  } else {
    publisher = projectPublisherFactories[publisherType]
  }

  const projectGeneratorFactory =
    projectType === ProjectType.HTML
      ? projectGeneratorFactories[projectType]({
          standaloneHtmlComponents,
          excludeHtmlComponentFiles: shouldexcludeHtmlComponentFiles,
        })
      : projectGeneratorFactories[projectType]()
  projectGeneratorFactory.cleanPlugins()

  projectGeneratorFactory.addPlugin(new ProjectPlugini18nFiles({ projectType }))

  if (projectType === ProjectType.HTML) {
    projectGeneratorFactory.addPlugin(pluginHomeReplace)
    projectGeneratorFactory.addPlugin(
      new ProjectPluginCloneGlobals({
        excludeGlobalsFromComponents: shouldExcludeGlobals,
        strictHtmlWhitespaceSensitivity,
      })
    )
    projectGeneratorFactory.addPlugin(htmlErrorPageMapping)
  }

  if (projectType === ProjectType.NEXT) {
    projectGeneratorFactory.addPlugin(new NextProjectPlugini18nConfig({ generateSitemap }))
    projectGeneratorFactory.addPlugin(new NextFormsCaptchaScriptPlugin())
    projectGeneratorFactory.addPlugin(new NextDataSourceDependenciesPlugin())
    projectGeneratorFactory.addPlugin(new NextDataSourceUtilityPlugin())
    projectGeneratorFactory.addPlugin(new NextWorkflowProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextEcommerceProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextGlobalStateProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextAIChatProjectPlugin())
    // Growth analytics tracker. Self-gates on `uidl.analytics?.enabled`, so it
    // is a no-op unless the project has analytics turned on. Must live here
    // (not only in createNextProjectGenerator) because packProject calls
    // cleanPlugins() and rebuilds the NEXT plugin list from scratch.
    projectGeneratorFactory.addPlugin(new NextAnalyticsProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextDashboardLayoutPlugin())
    projectGeneratorFactory.addPlugin(new NextRichTextEditorProjectPlugin())
    // Interactive-library primitives (calendar / drag-and-drop / kanban). Like
    // the plugins above, these must be re-added here because packProject runs
    // cleanPlugins() and rebuilds the NEXT project-plugin list from scratch —
    // the registrations in createNextProjectGenerator are wiped. Without these,
    // the wrapper component files, the calendarkit stylesheet, the React-18
    // bump and the .npmrc are never emitted, so the generated project fails to
    // install/build ("Module not found: '../components/tq-kanban'", ERESOLVE).
    projectGeneratorFactory.addPlugin(new NextCalendarKitProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextDragDropProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextKanbanProjectPlugin())
    projectGeneratorFactory.addPlugin(new NextCountdownProjectPlugin())
    // The npm-backed widget primitives (qr code, barcode, signature pad, color
    // picker, emoji picker, motion). Re-added here for the same reason
    // as the plugins above — packProject's cleanPlugins() wipes the registrations
    // from createNextProjectGenerator, so without this the wrapper component files
    // (components/tq-*.js) and their npm deps are never emitted and the project
    // fails to build ("Module not found: '../components/tq-signature'").
    createNextWidgetProjectPlugins().forEach((widgetPlugin) =>
      projectGeneratorFactory.addPlugin(widgetPlugin)
    )
  }

  if (projectType === ProjectType.NUXT) {
    projectGeneratorFactory.addPlugin(nuxtErrorPageMapper)
  }

  if (plugins?.length > 0) {
    plugins.forEach((plugin: ProjectPlugin) => {
      projectGeneratorFactory.addPlugin(plugin)
    })
  }

  const projectTemplate = templates[projectType]

  if (!projectGeneratorFactory) {
    throw new InvalidProjectTypeError(projectType)
  }

  if (publisherType && !publisher) {
    throw new InvalidPublisherTypeError(publisherType)
  }

  packer.setAssets({
    assets,
    path: assetsFolder,
  })

  packer.setGenerator(projectGeneratorFactory)
  packer.setTemplate(projectTemplate)

  // If no publisher is provided, the packer will return the generated project
  if (publisherType) {
    const publisherFactory = publisher
    const projectPublisher = publisherFactory(publishOptions)
    // @ts-ignore
    packer.setPublisher(projectPublisher)
  }

  return packer.pack(projectUIDL, { strictHtmlWhitespaceSensitivity, targetLocale })
}

export const generateComponent: GenerateComponentFunction = async (
  componentUIDL: ComponentUIDL,
  {
    componentType = ComponentType.REACT,
    styleVariation = ReactStyleVariation.CSSModules,
    componentGeneratorOptions = {
      extractedResources: {},
    },
    plugins = [],
  }: {
    componentType?: ComponentType
    styleVariation?: ReactStyleVariation
    componentGeneratorOptions?: GeneratorOptions
    plugins?: ComponentPlugin[]
  } = {}
) => {
  const generator = createComponentGenerator(componentType, styleVariation, plugins)
  const projectMapping = componentGeneratorProjectMappings[componentType]
  generator.addMapping(projectMapping as Mapping)

  if (componentType === ComponentType.HTML) {
    const { moduleComponents } = componentGeneratorOptions
    ;(generator as HTMLComponentGenerator).addExternalComponents({
      externals: moduleComponents,
      options: {},
    })
  }

  return generator.generateComponent(componentUIDL, componentGeneratorOptions)
}

const createComponentGenerator = (
  componentType: ComponentType,
  styleVariation: StyleVariation,
  plugins: ComponentPlugin[]
): ComponentGenerator => {
  const generatorFactory = componentGeneratorFactories[componentType]

  if (!generatorFactory) {
    throw new Error(`Invalid ComponentType: ${componentType}`)
  }

  if (componentType === ComponentType.REACT) {
    return generatorFactory({ variation: styleVariation, plugins })
  }

  return generatorFactory({ plugins })
}
