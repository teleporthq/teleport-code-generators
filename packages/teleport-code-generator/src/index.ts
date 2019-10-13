import { PublisherResponse, ProjectUIDL, ComponentUIDL } from '@teleporthq/teleport-types'
import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import { Constants } from '@teleporthq/teleport-shared'

import {
  ReactTemplate,
  createReactProjectGenerator,
} from '@teleporthq/teleport-project-generator-react'
import {
  createNextProjectGenerator,
  NextTemplate,
} from '@teleporthq/teleport-project-generator-next'
import { VueTemplate, createVueProjectGenerator } from '@teleporthq/teleport-project-generator-vue'
import {
  NuxtTemplate,
  createNuxtProjectGenerator,
} from '@teleporthq/teleport-project-generator-nuxt'
import {
  PreactTemplate,
  PreactCodesandBoxTemplate,
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

const componentGeneratorFactories = {
  [ComponentType.REACT]: createReactComponentGenerator,
  [ComponentType.PREACT]: createPreactComponentGenerator,
  [ComponentType.ANGULAR]: createAngularComponentGenerator,
  [ComponentType.VUE]: createVueComponentGenerator,
  [ComponentType.STENCIL]: createStencilComponentGenerator,
}

const projectGeneratorFactories = {
  [ProjectType.REACT]: createReactProjectGenerator,
  [ProjectType.NEXT]: createNextProjectGenerator,
  [ProjectType.VUE]: createVueProjectGenerator,
  [ProjectType.NUXT]: createNuxtProjectGenerator,
  [ProjectType.PREACT]: createPreactProjectGenerator,
  [ProjectType.STENCIL]: createStencilProjectGenerator,
  [ProjectType.ANGULAR]: createAngularProjectGenerator,
  [ProjectType.PREACT_CODESANDBOX]: createPreactProjectGenerator,
}

const templates = {
  [ProjectType.REACT]: ReactTemplate,
  [ProjectType.NEXT]: NextTemplate,
  [ProjectType.VUE]: VueTemplate,
  [ProjectType.NUXT]: NuxtTemplate,
  [ProjectType.PREACT]: PreactTemplate,
  [ProjectType.STENCIL]: StencilTemplate,
  [ProjectType.ANGULAR]: AngularTemplate,
  [ProjectType.PREACT_CODESANDBOX]: PreactCodesandBoxTemplate,
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
  {
    projectType = ProjectType.NEXT,
    publisher = PublisherType.ZIP,
    publishOptions = {},
    assets = [],
  }: PackerOptions = {}
): Promise<PublisherResponse<any>> => {
  const packer = createProjectPacker()

  const projectGeneratorFactory = projectGeneratorFactories[projectType]
  const projectTemplate = templates[projectType]
  const publisherFactory = projectPublisherFactories[publisher]

  if (!projectGeneratorFactory) {
    throw new Error(`Invalid ProjectType: ${projectType}`)
  }

  if (!publisherFactory) {
    throw new Error(`Invalid PublisherType: ${publisher}`)
  }

  const projectPublisher = publisherFactory(publishOptions)

  packer.setAssets({
    assets,
    path: [Constants.ASSETS_IDENTIFIER],
  })
  packer.setGenerator(projectGeneratorFactory())
  packer.setTemplate(projectTemplate)
  packer.setPublisher(projectPublisher)

  return packer.pack(projectUIDL)
}

const generateComponent = async (
  componentUIDL: ComponentUIDL,
  {
    componentType = ComponentType.REACT,
    styleVariation = ReactStyleVariation.CSSModules,
  }: GenerateOptions = {}
) => {
  const generator = createComponentGenerator(componentType, styleVariation)
  return generator.generateComponent(componentUIDL)
}

export {
  packProject,
  generateComponent,
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
  const generatorFactory = componentGeneratorFactories[componentType]

  if (!generatorFactory) {
    throw new Error(`Invalid ComponentType: ${componentType}`)
  }

  if (componentType === ComponentType.REACT || componentType === ComponentType.PREACT) {
    // @ts-ignore
    return generatorFactory(styleVariation)
  }

  return generatorFactory()
}
