import { PublisherResponse, ProjectUIDL } from '@teleporthq/teleport-types'
import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import { ASSETS_IDENTIFIER } from '@teleporthq/teleport-shared/dist/cjs/constants'

import reactProjectGenerator, { ReactTemplate } from '@teleporthq/teleport-project-generator-react'
import nextProjectGenerator, { NextTemplate } from '@teleporthq/teleport-project-generator-next'
import vueProjectGenerator, { VueTemplate } from '@teleporthq/teleport-project-generator-vue'
import nuxtProjectGenerator, { NuxtTemplate } from '@teleporthq/teleport-project-generator-nuxt'
import preactProjectGenerator, {
  PreactTemplate,
} from '@teleporthq/teleport-project-generator-preact'
import stencilProjectGenerator, {
  StencilTemplate,
} from '@teleporthq/teleport-project-generator-stencil'

import { createZipPublisher } from '@teleporthq/teleport-publisher-zip'
import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { createNowPublisher } from '@teleporthq/teleport-publisher-now'
import { createNetlifyPublisher } from '@teleporthq/teleport-publisher-netlify'
import { createGithubPublisher } from '@teleporthq/teleport-publisher-github'

import { PackerOptions } from './types'
import { PublisherType, GeneratorType } from './constants'

const projectGenerators = {
  [GeneratorType.REACT]: reactProjectGenerator,
  [GeneratorType.NEXT]: nextProjectGenerator,
  [GeneratorType.VUE]: vueProjectGenerator,
  [GeneratorType.NUXT]: nuxtProjectGenerator,
  [GeneratorType.PREACT]: preactProjectGenerator,
  [GeneratorType.STENCIL]: stencilProjectGenerator,
}

const templates = {
  [GeneratorType.REACT]: ReactTemplate,
  [GeneratorType.NEXT]: NextTemplate,
  [GeneratorType.VUE]: VueTemplate,
  [GeneratorType.NUXT]: NuxtTemplate,
  [GeneratorType.PREACT]: PreactTemplate,
  [GeneratorType.STENCIL]: StencilTemplate,
}

const projectPublishers = {
  [PublisherType.ZIP]: createZipPublisher,
  [PublisherType.DISK]: createDiskPublisher,
  [PublisherType.NOW]: createNowPublisher,
  [PublisherType.NETLIFY]: createNetlifyPublisher,
  [PublisherType.GITHUB]: createGithubPublisher,
}

const createPlaygroundPacker = (factoryOptions: PackerOptions = {}) => {
  const {
    publisher = PublisherType.ZIP,
    generator = GeneratorType.NEXT,
    publishOptions = {},
    assets = [],
  } = factoryOptions

  const packer = createProjectPacker()

  const pack = async (
    projectUIDL: ProjectUIDL,
    packOptions?: PackerOptions
  ): Promise<PublisherResponse<any>> => {
    const packGenerator = packOptions.generator || generator
    const packPublisher = packOptions.publisher || publisher
    const packPublishOptions = { ...publishOptions, ...packOptions.publishOptions }
    const packAssets = packOptions.assets || assets

    const projectGenerator =
      projectGenerators[packGenerator] || projectGenerators[GeneratorType.NEXT]
    const projectTemplate = templates[packGenerator] || templates[GeneratorType.NEXT]
    const publisherFactory =
      projectPublishers[packPublisher] || projectPublishers[PublisherType.ZIP]

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

  return {
    pack,
  }
}

export { createPlaygroundPacker, GeneratorType, PublisherType, PackerOptions }

export default createPlaygroundPacker()
