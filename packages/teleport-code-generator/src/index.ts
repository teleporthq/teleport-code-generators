import {
  PublisherResponse,
  ProjectUIDL,
  ComponentUIDL,
  Mapping,
  UIDLElement,
  GeneratorOptions,
} from '@teleporthq/teleport-types'
import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import { Constants } from '@teleporthq/teleport-shared'

import {
  ReactTemplate,
  createReactProjectGenerator,
} from '@teleporthq/teleport-project-generator-react'
import {
  createNextProjectGenerator,
  NextTemplate,
  NextMapping,
} from '@teleporthq/teleport-project-generator-next'
import { VueTemplate, createVueProjectGenerator } from '@teleporthq/teleport-project-generator-vue'
import {
  NuxtTemplate,
  createNuxtProjectGenerator,
} from '@teleporthq/teleport-project-generator-nuxt'
import {
  PreactTemplate,
  createPreactProjectGenerator,
} from '@teleporthq/teleport-project-generator-preact'
import {
  createStencilProjectGenerator,
  StencilTemplate,
} from '@teleporthq/teleport-project-generator-stencil'
import {
  createAngularProjectGenerator,
  AngularTemplate,
} from '@teleporthq/teleport-project-generator-angular'

import { createZipPublisher } from '@teleporthq/teleport-publisher-zip'
import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { createNowPublisher } from '@teleporthq/teleport-publisher-now'
import { createNetlifyPublisher } from '@teleporthq/teleport-publisher-netlify'
import { createGithubPublisher } from '@teleporthq/teleport-publisher-github'
import { createCodesandboxPublisher } from '@teleporthq/teleport-publisher-codesandbox'

import {
  createReactComponentGenerator,
  ReactStyleVariation,
} from '@teleporthq/teleport-component-generator-react'
import {
  createPreactComponentGenerator,
  PreactStyleVariation,
} from '@teleporthq/teleport-component-generator-preact'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'

import {
  PackerOptions,
  GenerateOptions,
  PublisherType,
  ProjectType,
  ComponentType,
  StyleVariation,
} from './types'

const ComponentStyleVariations = {
  [ComponentType.REACT]: ReactStyleVariation,
  [ComponentType.PREACT]: PreactStyleVariation,
}

const projectGenerators = {
  [ProjectType.REACT]: createReactProjectGenerator,
  [ProjectType.NEXT]: createNextProjectGenerator,
  [ProjectType.VUE]: createVueProjectGenerator,
  [ProjectType.NUXT]: createNuxtProjectGenerator,
  [ProjectType.PREACT]: createPreactProjectGenerator,
  [ProjectType.STENCIL]: createStencilProjectGenerator,
  [ProjectType.ANGULAR]: createAngularProjectGenerator,
}

const templates = {
  [ProjectType.REACT]: ReactTemplate,
  [ProjectType.NEXT]: NextTemplate,
  [ProjectType.VUE]: VueTemplate,
  [ProjectType.NUXT]: NuxtTemplate,
  [ProjectType.PREACT]: PreactTemplate,
  [ProjectType.STENCIL]: StencilTemplate,
  [ProjectType.ANGULAR]: AngularTemplate,
}

const projectPublisherFactories = {
  [PublisherType.ZIP]: createZipPublisher,
  [PublisherType.DISK]: createDiskPublisher,
  [PublisherType.NOW]: createNowPublisher,
  [PublisherType.NETLIFY]: createNetlifyPublisher,
  [PublisherType.GITHUB]: createGithubPublisher,
  [PublisherType.CODESANDBOX]: createCodesandboxPublisher,
}

const packProject = async (
  projectUIDL: ProjectUIDL,
  packOptions: PackerOptions = {}
): Promise<PublisherResponse<any>> => {
  const packer = createProjectPacker()

  const packProjectType = packOptions.projectType
  const packPublisher = packOptions.publisher
  const packPublishOptions = packOptions.publishOptions
  const packAssets = packOptions.assets

  const projectGenerator = projectGenerators[packProjectType]
  const projectTemplate = templates[packProjectType]
  const publisherFactory = projectPublisherFactories[packPublisher]

  if (!projectGenerator) {
    throw new Error(`Invalid ProjectType: ${packProjectType}`)
  }

  if (!publisherFactory) {
    throw new Error(`Invalid PublisherType: ${packPublisher}`)
  }

  const projectPublisher = publisherFactory(packPublishOptions)

  packer.setAssets({
    assets: packAssets,
    path: [Constants.ASSETS_IDENTIFIER],
  })
  packer.setGenerator(projectGenerator())
  packer.setTemplate(projectTemplate)
  packer.setPublisher(projectPublisher)

  return packer.pack(projectUIDL)
}

const generateComponent = async (
  componentUIDL: ComponentUIDL,
  generateOptions: GenerateOptions = {}
) => {
  const generateComponentType = generateOptions.componentType
  const generateStyleVariation = generateOptions.styleVariation
  const generator = createComponentGenerator(generateComponentType, generateStyleVariation)

  return generator.generateComponent(componentUIDL)
}

const resolveElement = (node: UIDLElement, options?: GeneratorOptions) => {
  const reactStyledJSXGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX, {
    mappings: [NextMapping as Mapping],
  })
  return reactStyledJSXGenerator.resolveElement(node, options)
}

export {
  packProject,
  generateComponent,
  resolveElement,
  ProjectType,
  PublisherType,
  ComponentType,
  StyleVariation,
  ComponentStyleVariations,
  ReactStyleVariation,
  PreactStyleVariation,
  PackerOptions,
}

const createComponentGenerator = (componentType: ComponentType, styleVariation: StyleVariation) => {
  const componentGeneratorFactories = {
    [ComponentType.REACT]: createReactComponentGenerator,
    [ComponentType.PREACT]: createPreactComponentGenerator,
    [ComponentType.ANGULAR]: createAngularComponentGenerator,
    [ComponentType.VUE]: createVueComponentGenerator,
    [ComponentType.STENCIL]: createStencilComponentGenerator,
  }

  const generatorFactory = componentGeneratorFactories[componentType]

  if (componentType === ComponentType.REACT || componentType === ComponentType.PREACT) {
    // @ts-ignore
    return generatorFactory(styleVariation)
  }

  return generatorFactory()
}
