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
    excludeGlobalsFromHTMLComponents = false,
    strictHtmlWhitespaceSensitivity = true,
  }
) => {
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

  const projectGeneratorFactory = projectGeneratorFactories[projectType]()
  projectGeneratorFactory.cleanPlugins()

  projectGeneratorFactory.addPlugin(new ProjectPlugini18nFiles({ projectType }))

  if (projectType === ProjectType.HTML) {
    projectGeneratorFactory.addPlugin(pluginHomeReplace)
    projectGeneratorFactory.addPlugin(
      new ProjectPluginCloneGlobals({
        excludeGlobalsFromComponents: excludeGlobalsFromHTMLComponents,
        strictHtmlWhitespaceSensitivity,
      })
    )
    projectGeneratorFactory.addPlugin(htmlErrorPageMapping)
  }

  if (projectType === ProjectType.NEXT) {
    projectGeneratorFactory.addPlugin(new NextProjectPlugini18nConfig())
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

  return packer.pack(projectUIDL, { strictHtmlWhitespaceSensitivity })
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
