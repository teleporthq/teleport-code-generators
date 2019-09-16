import {
  PublisherResponse,
  ProjectUIDL,
  ComponentUIDL,
  Mapping,
  UIDLElement,
  GeneratorOptions,
} from '@teleporthq/teleport-types'
import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import { ASSETS_IDENTIFIER } from '@teleporthq/teleport-shared/dist/cjs/constants'

import reactProjectGenerator, { ReactTemplate } from '@teleporthq/teleport-project-generator-react'
import nextProjectGenerator, {
  NextTemplate,
  NextMapping,
} from '@teleporthq/teleport-project-generator-next'
import vueProjectGenerator, { VueTemplate } from '@teleporthq/teleport-project-generator-vue'
import nuxtProjectGenerator, { NuxtTemplate } from '@teleporthq/teleport-project-generator-nuxt'
import preactProjectGenerator, {
  PreactTemplate,
} from '@teleporthq/teleport-project-generator-preact'
import stencilProjectGenerator, {
  StencilTemplate,
} from '@teleporthq/teleport-project-generator-stencil'
import angularProjectGenerator, {
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

const projectGenerators = {
  [ProjectType.REACT]: reactProjectGenerator,
  [ProjectType.NEXT]: nextProjectGenerator,
  [ProjectType.VUE]: vueProjectGenerator,
  [ProjectType.NUXT]: nuxtProjectGenerator,
  [ProjectType.PREACT]: preactProjectGenerator,
  [ProjectType.STENCIL]: stencilProjectGenerator,
  [ProjectType.ANGULAR]: angularProjectGenerator,
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

const componentGeneratorFactories = {
  [ComponentType.REACT]: createReactComponentGenerator,
  [ComponentType.PREACT]: createPreactComponentGenerator,
  [ComponentType.ANGULAR]: createAngularComponentGenerator,
  [ComponentType.VUE]: createVueComponentGenerator,
  [ComponentType.STENCIL]: createStencilComponentGenerator,
}

const ComponentStyleVariations = {
  [ComponentType.REACT]: ReactStyleVariation,
  [ComponentType.PREACT]: PreactStyleVariation,
}

const reactStyledJSXGenerator = createReactComponentGenerator(ReactStyleVariation.StyledJSX, {
  mappings: [NextMapping as Mapping],
})

const createCodeGenerator = (factoryOptions: PackerOptions & GenerateOptions = {}) => {
  const {
    publisher = PublisherType.ZIP,
    projectType = ProjectType.NEXT,
    publishOptions = {},
    assets = [],
    componentType = ComponentType.REACT,
    styleVariation = ReactStyleVariation.CSSModules,
  } = factoryOptions

  const packer = createProjectPacker()

  const packProject = async (
    projectUIDL: ProjectUIDL,
    packOptions: PackerOptions = {}
  ): Promise<PublisherResponse<any>> => {
    const packProjectType = packOptions.projectType || projectType
    const packPublisher = packOptions.publisher || publisher
    const packPublishOptions = { ...publishOptions, ...packOptions.publishOptions }
    const packAssets = packOptions.assets || assets

    const projectGenerator =
      projectGenerators[packProjectType] || projectGenerators[ProjectType.NEXT]
    const projectTemplate = templates[packProjectType] || templates[ProjectType.NEXT]
    const publisherFactory =
      projectPublisherFactories[packPublisher] || projectPublisherFactories[PublisherType.ZIP]

    const projectPublisher = publisherFactory(packPublishOptions)

    packer.setAssets({
      assets: packAssets,
      path: [ASSETS_IDENTIFIER],
    })
    packer.setGenerator(projectGenerator)
    packer.setTemplate(projectTemplate)
    packer.setPublisher(projectPublisher)

    return packer.pack(projectUIDL)
  }

  const generateComponent = async (
    componentUIDL: ComponentUIDL,
    generateOptions: GenerateOptions = {}
  ) => {
    const generateComponentType = generateOptions.componentType || componentType
    const generateStyleVariation = generateOptions.styleVariation || styleVariation
    const generator = createComponentGenerator(generateComponentType, generateStyleVariation)

    return generator.generateComponent(componentUIDL)
  }

  const resolveElement = (node: UIDLElement, options?: GeneratorOptions) => {
    return reactStyledJSXGenerator.resolveElement(node, options)
  }

  return {
    packProject,
    generateComponent,
    resolveElement,
  }
}

export {
  createCodeGenerator,
  ProjectType,
  PublisherType,
  ComponentType,
  StyleVariation,
  ComponentStyleVariations,
  ReactStyleVariation,
  PreactStyleVariation,
  PackerOptions,
}

export default createCodeGenerator()

const createComponentGenerator = (componentType: string, styleVariation: StyleVariation) => {
  const generatorFactory = componentGeneratorFactories[componentType]

  if (componentType === ComponentType.REACT || componentType === ComponentType.PREACT) {
    return generatorFactory(styleVariation)
  }

  return generatorFactory()
}
