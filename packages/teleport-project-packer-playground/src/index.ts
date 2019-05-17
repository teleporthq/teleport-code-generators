import {
  AssetsDefinition,
  PublisherResponse,
  TemplateDefinition,
  GeneratedFolder,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ProjectUIDL, Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

import createTeleportPacker from '@teleporthq/teleport-project-packer'

import createReactGenerator from '@teleporthq/teleport-project-generator-react-basic'
import createReactNextGenerator from '@teleporthq/teleport-project-generator-react-next'
import createVueGenerator from '@teleporthq/teleport-project-generator-vue-basic'
import createVueNuxtGenerator from '@teleporthq/teleport-project-generator-vue-nuxt'

import createZipPublisher from '@teleporthq/teleport-publisher-zip'
import createDiskPublisher from '@teleporthq/teleport-publisher-disk'
import createNowPublisher from '@teleporthq/teleport-publisher-now'
import createNetlifyPublisher from '@teleporthq/teleport-publisher-netlify'

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
  ReactBasic: createReactGenerator,
  ReactNext: createReactNextGenerator,
  VueBasic: createVueGenerator,
  VueNuxt: createVueNuxtGenerator,
}

const projectPublishers = {
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

const createPlaygroundPacker = (projectUIDL: ProjectUIDL, params: PackerFactoryParams = {}) => {
  const { assets, publisher, technology } = params
  let { template } = params

  const packer = createTeleportPacker(projectUIDL, { assets, template })

  const loadTemplate = async (templateToLoad?: TemplateDefinition): Promise<GeneratedFolder> => {
    template = templateToLoad || template
    template.templateFolder = await packer.loadTemplate(template)
    return template.templateFolder
  }

  const pack = async (packParams: PackerFactoryParams = {}): Promise<PublisherResponse<any>> => {
    const projectAssets = packParams.assets || assets

    const packTechnology = packParams.technology || technology
    const packPublisher = packParams.publisher || publisher

    const generatorFactory = projectGenerators[packTechnology.type] || createReactNextGenerator
    const projectGenerator = generatorFactory({ ...packTechnology.meta })

    const publisherFactory = projectPublishers[packPublisher.type] || createZipPublisher
    const projectPublisher = publisherFactory({ ...packPublisher.meta })

    const templateByTechnology =
      technology && technology.type ? projectTemplates[technology.type] : projectTemplates.ReactNext

    const projectTemplate = packParams.template || template || templateByTechnology

    packer.setAssets(projectAssets)
    packer.setGeneratorFunction(projectGenerator.generateProject)
    packer.setPublisher(projectPublisher)
    packer.setTemplate(projectTemplate)

    return packer.pack()
  }

  return {
    loadTemplate,
    pack,
  }
}

export default createPlaygroundPacker
