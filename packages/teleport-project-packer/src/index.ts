import {
  AssetsDefinition,
  Publisher,
  ProjectGenerator,
  PublisherResponse,
  ProjectUIDL,
  GeneratedFolder,
  RemoteTemplateDefinition,
} from '@teleporthq/teleport-types'
import { injectAssetsToProject, fetchTemplate } from './utils'
import { NO_GENERATOR_PROVIDED } from './errors'
import { DEFAULT_TEMPLATE } from './constants'

export interface PackerFactoryParams {
  publisher?: Publisher<any, any>
  generator?: ProjectGenerator
  template?: GeneratedFolder
  remoteTemplateDefinition?: RemoteTemplateDefinition
  assets?: AssetsDefinition
}

export type PackerFactory = (
  params?: PackerFactoryParams
) => {
  pack: (projectUIDL?: ProjectUIDL, params?: PackerFactoryParams) => Promise<PublisherResponse<any>>
  loadRemoteTemplate: (remoteTemplateDefinition: RemoteTemplateDefinition) => Promise<void>
  setPublisher: <T, U>(publisher: Publisher<T, U>) => void
  setGenerator: (generator: ProjectGenerator) => void
  setAssets: (assets: AssetsDefinition) => void
  setTemplate: (templateFolder: GeneratedFolder) => void
}

export const createProjectPacker: PackerFactory = (params: PackerFactoryParams = {}) => {
  let { assets, generator, publisher, template } = params

  template = template || DEFAULT_TEMPLATE

  const setPublisher = <T, U>(publisherToSet: Publisher<T, U>): void => {
    publisher = publisherToSet
  }

  const setGenerator = (generatorToSet: ProjectGenerator): void => {
    generator = generatorToSet
  }

  const setAssets = (assetsToSet: AssetsDefinition): void => {
    assets = assetsToSet
  }

  const setTemplate = (templateFolder: GeneratedFolder): void => {
    template = templateFolder
  }

  const loadRemoteTemplate = async (remoteDefinition: RemoteTemplateDefinition): Promise<void> => {
    template = await fetchTemplate(remoteDefinition)
  }

  const pack = async (uidl: ProjectUIDL, packParams: PackerFactoryParams = {}) => {
    const definedProjectUIDL = uidl

    const packGenerator = packParams.generator || generator
    if (!packGenerator) {
      return { success: false, payload: NO_GENERATOR_PROVIDED }
    }

    const packPublisher = packParams.publisher || publisher

    const packAssets = packParams.assets || assets
    let templateFolder = packParams.template || template

    // If a remote template is supplied at pack time, it will be fetched,
    // but not saved inside the packer for a secondary use
    if (!packParams.template && packParams.remoteTemplateDefinition) {
      templateFolder = await fetchTemplate(packParams.remoteTemplateDefinition)
    }

    const outputFolder = await packGenerator.generateProject(definedProjectUIDL, templateFolder)
    const assetsPath = packGenerator.getAssetsPath()

    const project = await injectAssetsToProject(outputFolder, packAssets, assetsPath)

    if (packPublisher) {
      return packPublisher.publish({ project })
    }

    // If no publisher is provided, return the generated project
    return {
      success: true,
      payload: project,
    }
  }

  return {
    setPublisher,
    setGenerator,
    setAssets,
    setTemplate,
    loadRemoteTemplate,
    pack,
  }
}
