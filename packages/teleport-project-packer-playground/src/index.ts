import {
  AssetsDefinition,
  PublisherResponse,
  TemplateDefinition,
  ProjectUIDL,
  Mapping,
  GithubAuthMeta,
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
import { createGithubPublisher } from '@teleporthq/teleport-publisher-github'

import {
  GITHUB_TEMPLATE_OWNER,
  REACT_BASIC_GITHUB_PROJECT,
  REACT_NEXT_GITHUB_PROJECT,
  VUE_GITHUB_PROJECT,
  VUE_NUXT_GITHUB_PROJECT,
  PUBLISHERS,
  GENERATORS,
  TEMPLATES,
} from './constants'
import { GENERATOR_NOT_FOUND, PUBLISHER_NOT_FOUND } from './errors'

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
  github?: {
    authMeta?: GithubAuthMeta
    repositoryOwner?: string
    repository?: string
    masterBranch?: string
    commitBranch?: string
    commitMessage?: string
  }
}

const projectGenerators = {
  [GENERATORS.REACT_BASIC]: createReactBasicGenerator,
  [GENERATORS.REACT_NEXT]: createReactNextGenerator,
  [GENERATORS.VUE_BASIC]: createVueBasicGenerator,
  [GENERATORS.VUE_NUXT]: createVueNuxtGenerator,
}

type SupportedPublishers =
  | typeof createDiskPublisher
  | typeof createZipPublisher
  | typeof createNowPublisher
  | typeof createNetlifyPublisher
  | typeof createGithubPublisher

const projectPublishers: Record<string, SupportedPublishers> = {
  [PUBLISHERS.DISK]: createDiskPublisher,
  [PUBLISHERS.ZIP]: createZipPublisher,
  [PUBLISHERS.NOW]: createNowPublisher,
  [PUBLISHERS.NETLIFY]: createNetlifyPublisher,
  [PUBLISHERS.GITHUB]: createGithubPublisher,
}

const getGithubRemoteDefinition = (username: string, repo: string) => {
  return { remote: { githubRepo: { username, repo } } }
}

const projectTemplates = {
  [TEMPLATES.REACT_BASIC]: getGithubRemoteDefinition(
    GITHUB_TEMPLATE_OWNER,
    REACT_BASIC_GITHUB_PROJECT
  ),
  [TEMPLATES.REACT_NEXT]: getGithubRemoteDefinition(
    GITHUB_TEMPLATE_OWNER,
    REACT_NEXT_GITHUB_PROJECT
  ),
  [TEMPLATES.VUE_BASIC]: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_GITHUB_PROJECT),
  [TEMPLATES.VUE_NUXT]: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_NUXT_GITHUB_PROJECT),
}

const defaultTechnology = {
  type: GENERATORS.REACT_NEXT,
  meta: {},
}

const defaultPublisher = {
  type: PUBLISHERS.ZIP,
  meta: {},
  github: {},
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
    if (!generatorFactory) {
      return { success: false, payload: GENERATOR_NOT_FOUND }
    }

    const publisherFactory = projectPublishers[packPublisher.type]
    if (!publisherFactory) {
      return { success: false, payload: PUBLISHER_NOT_FOUND }
    }

    const templateByTechnology =
      technology && technology.type ? projectTemplates[technology.type] : projectTemplates.ReactNext

    const projectTemplate = packParams.template || template || templateByTechnology

    const projectGenerator = generatorFactory({ ...packTechnology.meta })

    const meta =
      packPublisher.type === PUBLISHERS.GITHUB ? packPublisher.github : packPublisher.meta
    const projectPublisher = publisherFactory({ ...meta })

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
