import {
  GeneratedFolder,
  PublisherFactoryParams,
  PublisherFactory,
  Publisher,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { NO_PROJECT_UIDL } from './errors'
import { isNodeProcess, writeZipToDisk, generateProjectZip } from './utils'

declare type ZipPublisherResponse = string | Buffer | Blob

export interface ZipFactoryParams extends PublisherFactoryParams {
  outputPath?: string
}

export interface ZipPublisher extends Publisher<ZipFactoryParams, ZipPublisherResponse> {
  getOutputPath: () => string
  setOutputPath: (path: string) => void
}

const createZipPublisher: PublisherFactory<ZipFactoryParams, ZipPublisher> = (
  params: ZipFactoryParams = {}
): ZipPublisher => {
  const { projectName } = params
  let { project, outputPath } = params

  const getProject = () => project
  const setProject = (projectToSet: GeneratedFolder) => {
    project = projectToSet
  }

  const getOutputPath = () => outputPath
  const setOutputPath = (path: string) => {
    outputPath = path
  }

  const publish = async (options: ZipFactoryParams = {}) => {
    const projectOutputPath = options.outputPath || outputPath
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    try {
      const zipContent = await generateProjectZip(projectToPublish)

      if (projectOutputPath && isNodeProcess()) {
        await writeZipToDisk(projectOutputPath, zipContent, projectName || projectToPublish.name)
      }
      return { success: true, payload: zipContent }
    } catch (error) {
      return { success: false, payload: error }
    }
  }

  return {
    publish,
    getProject,
    setProject,
    getOutputPath,
    setOutputPath,
  }
}

export default createZipPublisher
