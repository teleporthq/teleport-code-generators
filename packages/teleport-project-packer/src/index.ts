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

export interface PackerFactoryParams {
  publisher?: Publisher<any, any>
  generatorFunction?: GenerateProjectFunction
  template?: TemplateDefinition
  assets?: AssetsDefinition
}

type PackerFactory = (
  projectUIDL: ProjectUIDL,
  params: PackerFactoryParams
) => {
  pack: () => Promise<PublisherResponse<any>>
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

  const setPublisher = (publisherToSet: Publisher<any, any>): void => {
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
    return fetchTemplate(template.remote)
  }

  const pack = async () => {
    if (template && template.remote) {
      template.templateFolder = await fetchTemplate(template.remote)
    }

    const { assetsPath, outputFolder } = await generatorFunction(projectUIDL, template)

    const project = await injectAssetsToProject(outputFolder, assets, assetsPath)

    publisher.setProject(project)
    return publisher.publish()
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
