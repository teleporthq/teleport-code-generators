import {
  AssetsDefinition,
  Publisher,
  GenerateProjectFunction,
  PublisherResponse,
  ProjectUIDL,
  GeneratedFolder,
  RemoteTemplateDefinition,
} from '@teleporthq/teleport-types'
import { injectAssetsToProject, fetchTemplate } from './utils'
import { NO_GENERATOR_FUNCTION_PROVIDED, NO_PUBLISHER_PROVIDED } from './errors'
import { DEFAULT_TEMPLATE } from './constants'

export interface PackerFactoryParams {
  publisher?: Publisher<any, any>
  generatorFunction?: GenerateProjectFunction
  template?: GeneratedFolder
  remoteTemplateDefinition?: RemoteTemplateDefinition
  assets?: AssetsDefinition
}

export type PackerFactory = (
  params?: PackerFactoryParams
) => {
  pack: (projectUIDL?: ProjectUIDL, params?: PackerFactoryParams) => Promise<PublisherResponse<any>>
  loadTemplate: (remoteTemplateDefinition: RemoteTemplateDefinition) => Promise<GeneratedFolder>
  setPublisher: <T, U>(publisher: Publisher<T, U>) => void
  setGeneratorFunction: (generatorFunction: GenerateProjectFunction) => void
  setAssets: (assets: AssetsDefinition) => void
  setTemplate: (templateFolder: GeneratedFolder) => void
}

export const createProjectPacker: PackerFactory = (params: PackerFactoryParams = {}) => {
  let { assets, generatorFunction, publisher, template } = params

  template = template || DEFAULT_TEMPLATE

  const setPublisher = <T, U>(publisherToSet: Publisher<T, U>): void => {
    publisher = publisherToSet
  }

  const setGeneratorFunction = (functionToSet: GenerateProjectFunction): void => {
    generatorFunction = functionToSet
  }

  const setAssets = (assetsToSet: AssetsDefinition): void => {
    assets = assetsToSet
  }

  const setTemplate = (templateFolder: GeneratedFolder): void => {
    template = templateFolder
  }

  const loadTemplate = async (
    remoteDefinition: RemoteTemplateDefinition
  ): Promise<GeneratedFolder> => {
    try {
      template = await fetchTemplate(remoteDefinition)
      return template // TODO: is this useful?
    } catch (err) {
      throw err // TODO: error handling here?
    }
  }

  const pack = async (uidl: ProjectUIDL, packParams: PackerFactoryParams = {}) => {
    const definedProjectUIDL = uidl

    const packGeneratorFunction = packParams.generatorFunction || generatorFunction
    if (!packGeneratorFunction) {
      return { success: false, payload: NO_GENERATOR_FUNCTION_PROVIDED }
    }

    const packPublisher = packParams.publisher || publisher
    if (!packPublisher) {
      return { success: false, payload: NO_PUBLISHER_PROVIDED }
    }

    const packAssets = packParams.assets || assets

    let templateFolder = packParams.template || template
    if (!packParams.template && packParams.remoteTemplateDefinition) {
      templateFolder = await loadTemplate(packParams.remoteTemplateDefinition)
    }

    const { assetsPath, outputFolder } = await packGeneratorFunction(
      definedProjectUIDL,
      templateFolder
    )

    const project = await injectAssetsToProject(outputFolder, packAssets, assetsPath)

    return packPublisher.publish({ project })
  }

  return {
    setPublisher,
    setGeneratorFunction,
    setAssets,
    setTemplate,
    loadTemplate,
    pack,
  }
}

export default createProjectPacker()
