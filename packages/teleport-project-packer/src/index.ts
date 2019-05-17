import {
  AssetsDefinition,
  Publisher,
  GenerateProjectFunction,
  PublisherResponse,
  TemplateDefinition,
  GeneratedFolder,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { injectAssetsToProject, fetchTemplate } from './utils'
import {
  NO_PROJECT_UIDL_PROVIDED,
  NO_TEMPLATE_PROVIDED,
  NO_GENERATOR_FUNCTION_PROVIDED,
  NO_PUBLISHER_PROVIDED,
} from './errors'

export interface PackerFactoryParams {
  publisher?: Publisher<any, any>
  generatorFunction?: GenerateProjectFunction
  template?: TemplateDefinition
  assets?: AssetsDefinition
}

export type PackerFactory = (
  projectUIDL: ProjectUIDL,
  params: PackerFactoryParams
) => {
  pack: (projectUIDL?: ProjectUIDL, params?: PackerFactoryParams) => Promise<PublisherResponse<any>>
  loadTemplate: (template?: TemplateDefinition) => Promise<GeneratedFolder>
  setPublisher: (publisher: Publisher<any, any>) => void
  setGeneratorFunction: (generatorFunction: GenerateProjectFunction) => void
  setAssets: (assets: AssetsDefinition) => void
  setProjectUIDL: (uidl: ProjectUIDL) => void
  setTemplate: (template: TemplateDefinition) => void
}

const createTeleportPacker: PackerFactory = (
  projectUIDL: ProjectUIDL,
  params?: PackerFactoryParams
) => {
  let { assets, generatorFunction, publisher, template } = params

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

  const loadTemplate = async (templateToLoad?: TemplateDefinition): Promise<GeneratedFolder> => {
    templateToLoad = templateToLoad || template
    if (!templateToLoad) {
      return null
    }

    if (template.templateFolder) {
      return template.templateFolder
    }

    if (!template.remote) {
      return null
    }

    template.templateFolder = await fetchTemplate(template.remote)
    return template.templateFolder
  }

  const pack = async (uidl?: ProjectUIDL, packParams?: PackerFactoryParams) => {
    const definedProjectUIDL = uidl || projectUIDL
    if (!definedProjectUIDL) {
      throw new Error(NO_PROJECT_UIDL_PROVIDED)
    }

    const packTemplate = packParams.template || template
    if (!packTemplate) {
      throw new Error(NO_TEMPLATE_PROVIDED)
    }

    const packGeneratorFunction = packParams.generatorFunction || generatorFunction
    if (!packGeneratorFunction) {
      throw new Error(NO_GENERATOR_FUNCTION_PROVIDED)
    }

    const packPublisher = packParams.publisher || publisher
    if (!packPublisher) {
      throw new Error(NO_PUBLISHER_PROVIDED)
    }

    const packAssets = packParams.assets || assets

    if (template && template.remote) {
      template.templateFolder = await fetchTemplate(template.remote)
    }

    const { assetsPath, outputFolder } = await packGeneratorFunction(projectUIDL, template)

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
