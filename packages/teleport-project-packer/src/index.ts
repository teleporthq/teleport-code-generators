import {
  AssetsDefinition,
  Publisher,
  GenerateProjectFunction,
  PublisherResponse,
  TemplateDefinition,
  LoadTemplateResponse,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { injectAssetsToProject, fetchTemplate } from './utils'
import {
  NO_TEMPLATE_PROVIDED,
  NO_GENERATOR_FUNCTION_PROVIDED,
  NO_PUBLISHER_PROVIDED,
  NO_REMOTE_TEMPLATE_PROVIDED,
} from './errors'

export interface PackerFactoryParams {
  publisher?: Publisher<any, any>
  generatorFunction?: GenerateProjectFunction
  template?: TemplateDefinition
  assets?: AssetsDefinition
}

export type PackerFactory = (
  projectUIDL: ProjectUIDL,
  params?: PackerFactoryParams
) => {
  pack: (projectUIDL?: ProjectUIDL, params?: PackerFactoryParams) => Promise<PublisherResponse<any>>
  loadTemplate: (template?: TemplateDefinition) => Promise<LoadTemplateResponse>
  setPublisher: (publisher: Publisher<any, any>) => void
  setGeneratorFunction: (generatorFunction: GenerateProjectFunction) => void
  setAssets: (assets: AssetsDefinition) => void
  setProjectUIDL: (uidl: ProjectUIDL) => void
  setTemplate: (template: TemplateDefinition) => void
}

const createTeleportPacker: PackerFactory = (
  projectUIDL: ProjectUIDL,
  params: PackerFactoryParams = {}
) => {
  let { assets, generatorFunction, publisher, template } = params
  let templateLoaded = false

  const setPublisher = (publisherToSet: Publisher<unknown, unknown>): void => {
    publisher = publisherToSet
  }

  const setGeneratorFunction = (functionToSet: GenerateProjectFunction): void => {
    generatorFunction = functionToSet
  }

  const setAssets = (assetsToSet: AssetsDefinition): void => {
    assets = assetsToSet
  }

  const setProjectUIDL = (uidlToSet: ProjectUIDL): void => {
    projectUIDL = uidlToSet
  }

  const setTemplate = (templateToSet: TemplateDefinition): void => {
    template = templateToSet
  }

  const loadTemplate = async (
    templateToLoad?: TemplateDefinition
  ): Promise<LoadTemplateResponse> => {
    template = templateToLoad || template
    if (!template) {
      return { success: false, payload: NO_TEMPLATE_PROVIDED }
    }

    if (template.templateFolder) {
      return { success: true, payload: template.templateFolder }
    }

    if (!template.remote) {
      return { success: false, payload: NO_REMOTE_TEMPLATE_PROVIDED }
    }

    try {
      template.templateFolder = await fetchTemplate(template.remote)
      templateLoaded = true
      return { success: true, payload: template.templateFolder }
    } catch (err) {
      return { success: false, payload: err }
    }
  }

  const pack = async (uidl?: ProjectUIDL, packParams: PackerFactoryParams = {}) => {
    const definedProjectUIDL = uidl || projectUIDL

    const packTemplate = packParams.template || template
    if (!packTemplate) {
      return { success: false, payload: NO_TEMPLATE_PROVIDED }
    }

    const packGeneratorFunction = packParams.generatorFunction || generatorFunction
    if (!packGeneratorFunction) {
      return { success: false, payload: NO_GENERATOR_FUNCTION_PROVIDED }
    }

    const packPublisher = packParams.publisher || publisher
    if (!packPublisher) {
      return { success: false, payload: NO_PUBLISHER_PROVIDED }
    }

    const packAssets = packParams.assets || assets

    if (!templateLoaded) {
      const loaded = await loadTemplate(packTemplate)
      if (!loaded.success) {
        return loaded
      }
    }

    const { assetsPath, outputFolder } = await packGeneratorFunction(definedProjectUIDL, template)

    const project = await injectAssetsToProject(outputFolder, packAssets, assetsPath)

    packPublisher.setProject(project)
    return packPublisher.publish()
  }

  return {
    setPublisher,
    setGeneratorFunction,
    setAssets,
    setProjectUIDL,
    setTemplate,
    loadTemplate,
    pack,
  }
}

export default createTeleportPacker
