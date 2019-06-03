import {
  AssetsDefinition,
  PublisherResponse,
  TemplateDefinition,
  ProjectUIDL,
  Mapping,
} from '@teleporthq/teleport-types'

import { createProjectPacker } from '@teleporthq/teleport-project-packer'

import { createReactBasicGenerator } from '@teleporthq/teleport-project-generator-react-basic'
import { createReactNextGenerator } from '@teleporthq/teleport-project-generator-react-next'
import { createVueBasicGenerator } from '@teleporthq/teleport-project-generator-vue-basic'
import { createVueNuxtGenerator } from '@teleporthq/teleport-project-generator-vue-nuxt'

import { createZipPublisher } from '@teleporthq/teleport-publisher-zip'
import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { createNowPublisher } from '@teleporthq/teleport-publisher-now'
import { createNetlifyPublisher } from '@teleporthq/teleport-publisher-netlify'

import {
  GITHUB_TEMPLATE_OWNER,
  REACT_BASIC_GITHUB_PROJECT,
  REACT_NEXT_GITHUB_PROJECT,
  VUE_GITHUB_PROJECT,
  VUE_NUXT_GITHUB_PROJECT,
} from './constants'

export interface PackerFactoryParams {
  technology?: TechnologyDefinition
  publisher?: PublisherDefinition
  template?: TemplateDefinition
  assets?: AssetsDefinition
}

export interface TechnologyDefinition {
  type: string
  meta?: {
    variation?: string
    customMapping?: Mapping
  }
}

export interface PublisherDefinition {
  type: string
  meta?: {
    outputPath?: string
    accessToken?: string
    projectName?: string
  }
}

const projectGenerators = {
  ReactBasic: createReactBasicGenerator,
  ReactNext: createReactNextGenerator,
  VueBasic: createVueBasicGenerator,
  VueNuxt: createVueNuxtGenerator,
}

type SupportedPublishers =
  | typeof createDiskPublisher
  | typeof createZipPublisher
  | typeof createNowPublisher
  | typeof createNetlifyPublisher

const projectPublishers: Record<string, SupportedPublishers> = {
  Disk: createDiskPublisher,
  Zip: createZipPublisher,
  Now: createNowPublisher,
  Netlify: createNetlifyPublisher,
}

const getGithubRemoteDefinition = (owner: string, repo: string) => {
  return { remote: { githubRepo: { owner, repo } } }
}

const projectTemplates = {
  ReactBasic: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, REACT_BASIC_GITHUB_PROJECT),
  ReactNext: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, REACT_NEXT_GITHUB_PROJECT),
  Vue: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_GITHUB_PROJECT),
  VueNuxt: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_NUXT_GITHUB_PROJECT),
}

const defaultTechnology = {
  type: 'ReactNext',
  meta: {},
}

const defaultPublisher = {
  type: 'Zip',
  meta: {},
}

export const createPlaygroundPacker = (params: PackerFactoryParams = {}) => {
  const { assets, publisher, technology, template } = params

  const packer = createProjectPacker({ assets, template })

  const pack = async (
    projectUIDL: ProjectUIDL,
    packParams: PackerFactoryParams = {}
  ): Promise<PublisherResponse<any>> => {
    const projectAssets = packParams.assets || assets

    const packTechnology = packParams.technology || technology || defaultTechnology
    const packPublisher = packParams.publisher || publisher || defaultPublisher

    const generatorFactory = projectGenerators[packTechnology.type]
    const projectGenerator = generatorFactory({ ...packTechnology.meta })

    const publisherFactory = projectPublishers[packPublisher.type]
    const projectPublisher = publisherFactory({ ...packPublisher.meta })

    const templateByTechnology =
      technology && technology.type ? projectTemplates[technology.type] : projectTemplates.ReactNext

    const projectTemplate = packParams.template || template || templateByTechnology

    packer.setAssets(projectAssets)
    packer.setGeneratorFunction(projectGenerator.generateProject)
    packer.setPublisher(projectPublisher)
    packer.setTemplate(projectTemplate)

    return packer.pack(projectUIDL)
  }

  return {
    pack,
    loadTemplate: packer.loadTemplate.bind(this),
  }
}

export default createPlaygroundPacker()
