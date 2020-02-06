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
} from '@teleporthq/teleport-types'
import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import { Constants } from '@teleporthq/teleport-shared'

import {
  ReactTemplate,
  createReactProjectGenerator,
  ReactProjectMapping,
} from '@teleporthq/teleport-project-generator-react'
import {
  createNextProjectGenerator,
  NextTemplate,
} from '@teleporthq/teleport-project-generator-next'
import {
  VueTemplate,
  createVueProjectGenerator,
  VueProjectMapping,
} from '@teleporthq/teleport-project-generator-vue'
import {
  NuxtTemplate,
  createNuxtProjectGenerator,
} from '@teleporthq/teleport-project-generator-nuxt'
import {
  PreactTemplate,
  PreactCodesandBoxTemplate,
  createPreactProjectGenerator,
  PreactProjectMapping,
} from '@teleporthq/teleport-project-generator-preact'
import {
  createStencilProjectGenerator,
  StencilTemplate,
  StencilProjectMapping,
} from '@teleporthq/teleport-project-generator-stencil'
import {
  createReactNativeProjectGenerator,
  ReactNativeTemplate,
  ReactNativeProjectMapping,
} from '@teleporthq/teleport-project-generator-reactnative'
import {
  createAngularProjectGenerator,
  AngularTemplate,
  AngularProjectMapping,
} from '@teleporthq/teleport-project-generator-angular'
import {
  createGridsomeProjectGenerator,
  GridsomeTemplate,
} from '@teleporthq/teleport-project-generator-gridsome'
import {
  createGatsbyProjectGenerator,
  GatsbyTemplate,
} from '@teleporthq/teleport-project-generator-gatsby'

import { createZipPublisher } from '@teleporthq/teleport-publisher-zip'
import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { createNowPublisher } from '@teleporthq/teleport-publisher-now'
import { createNetlifyPublisher } from '@teleporthq/teleport-publisher-netlify'
import { createGithubPublisher } from '@teleporthq/teleport-publisher-github'
import { createCodesandboxPublisher } from '@teleporthq/teleport-publisher-codesandbox'

import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createPreactComponentGenerator } from '@teleporthq/teleport-component-generator-preact'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
import { createReactNativeComponentGenerator } from '@teleporthq/teleport-component-generator-reactnative'

const componentGeneratorFactories = {
  [ComponentType.REACT]: createReactComponentGenerator,
  [ComponentType.PREACT]: createPreactComponentGenerator,
  [ComponentType.ANGULAR]: createAngularComponentGenerator,
  [ComponentType.VUE]: createVueComponentGenerator,
  [ComponentType.STENCIL]: createStencilComponentGenerator,
  [ComponentType.REACTNATIVE]: createReactNativeComponentGenerator,
}

const componentGeneratorProjectMappings = {
  [ComponentType.REACT]: ReactProjectMapping,
  [ComponentType.PREACT]: PreactProjectMapping,
  [ComponentType.ANGULAR]: AngularProjectMapping,
  [ComponentType.VUE]: VueProjectMapping,
  [ComponentType.STENCIL]: StencilProjectMapping,
  [ComponentType.REACTNATIVE]: ReactNativeProjectMapping,
}

const projectGeneratorFactories = {
  [ProjectType.REACT]: createReactProjectGenerator,
  [ProjectType.NEXT]: createNextProjectGenerator,
  [ProjectType.VUE]: createVueProjectGenerator,
  [ProjectType.NUXT]: createNuxtProjectGenerator,
  [ProjectType.PREACT]: createPreactProjectGenerator,
  [ProjectType.STENCIL]: createStencilProjectGenerator,
  [ProjectType.ANGULAR]: createAngularProjectGenerator,
  [ProjectType.REACTNATIVE]: createReactNativeProjectGenerator,
  [ProjectType.GRIDSOME]: createGridsomeProjectGenerator,
  [ProjectType.GATSBY]: createGatsbyProjectGenerator,
}

const templates = {
  [ProjectType.REACT]: ReactTemplate,
  [ProjectType.NEXT]: NextTemplate,
  [ProjectType.VUE]: VueTemplate,
  [ProjectType.NUXT]: NuxtTemplate,
  [ProjectType.PREACT]: PreactTemplate,
  [ProjectType.STENCIL]: StencilTemplate,
  [ProjectType.REACTNATIVE]: ReactNativeTemplate,
  [ProjectType.ANGULAR]: AngularTemplate,
  [ProjectType.GRIDSOME]: GridsomeTemplate,
  [ProjectType.GATSBY]: GatsbyTemplate,
}

const projectPublisherFactories = {
  [PublisherType.ZIP]: createZipPublisher,
  [PublisherType.DISK]: createDiskPublisher,
  [PublisherType.NOW]: createNowPublisher,
  [PublisherType.NETLIFY]: createNetlifyPublisher,
  [PublisherType.GITHUB]: createGithubPublisher,
  [PublisherType.CODESANDBOX]: createCodesandboxPublisher,
}

export const packProject: PackProjectFunction = async (
  projectUIDL,
  { projectType, publisher, publishOptions = {}, assets = [] }
) => {
  const packer = createProjectPacker()

  const projectGeneratorFactory = projectGeneratorFactories[projectType]
  const projectTemplate =
    projectType === ProjectType.PREACT && publisher === PublisherType.CODESANDBOX
      ? PreactCodesandBoxTemplate
      : templates[projectType]

  if (!projectGeneratorFactory) {
    throw new InvalidProjectTypeError(projectType)
  }

  if (publisher && !projectPublisherFactories[publisher]) {
    throw new InvalidPublisherTypeError(publisher)
  }

  packer.setAssets({
    assets,
    path: [Constants.ASSETS_IDENTIFIER],
  })

  packer.setGenerator(projectGeneratorFactory())
  packer.setTemplate(projectTemplate)

  // If no publisher is provided, the packer will return the generated project
  if (publisher) {
    const publisherFactory = projectPublisherFactories[publisher]
    const projectPublisher = publisherFactory(publishOptions)
    // @ts-ignore
    packer.setPublisher(projectPublisher)
  }

  return packer.pack(projectUIDL)
}

export const generateComponent: GenerateComponentFunction = async (
  componentUIDL: ComponentUIDL,
  { componentType = ComponentType.REACT, styleVariation = ReactStyleVariation.CSSModules } = {}
) => {
  const generator = createComponentGenerator(componentType, styleVariation)
  const projectMapping = componentGeneratorProjectMappings[componentType]
  generator.addMapping(projectMapping)
  return generator.generateComponent(componentUIDL)
}

const createComponentGenerator = (componentType: ComponentType, styleVariation: StyleVariation) => {
  const generatorFactory = componentGeneratorFactories[componentType]

  if (!generatorFactory) {
    throw new Error(`Invalid ComponentType: ${componentType}`)
  }

  if (
    componentType === ComponentType.REACT ||
    componentType === ComponentType.PREACT ||
    componentType === ComponentType.REACTNATIVE
  ) {
    // @ts-ignore
    return generatorFactory(styleVariation)
  }

  return generatorFactory()
}
