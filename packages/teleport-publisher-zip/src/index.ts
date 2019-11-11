import {
  GeneratedFolder,
  PublisherFactoryParams,
  PublisherFactory,
  Publisher,
} from '@teleporthq/teleport-types'
import { NO_PROJECT_UIDL } from './errors'
import { isNodeProcess, writeZipToDisk, generateProjectZip } from './utils'

declare type ZipPublisherResponse = string | Buffer | Blob

export interface ZipFactoryParams extends PublisherFactoryParams {
  outputPath?: string
  projectSlug?: string
}

export interface ZipPublisher extends Publisher<ZipFactoryParams, ZipPublisherResponse> {
  getOutputPath: () => string
  setOutputPath: (path: string) => void
}

export const createZipPublisher: PublisherFactory<ZipFactoryParams, ZipPublisher> = (
  params: ZipFactoryParams = {}
): ZipPublisher => {
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
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const zipName = options.projectSlug || params.projectSlug || projectToPublish.name

    try {
      const zipContent = await generateProjectZip(projectToPublish)

      // If not output path is provided, zip is not written to disk
      const projectOutputPath = options.outputPath || outputPath
      if (projectOutputPath && isNodeProcess()) {
        await writeZipToDisk(projectOutputPath, zipContent, zipName)
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
