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
  outputZipName?: string
}

export interface ZipPublisher extends Publisher<ZipFactoryParams, ZipPublisherResponse> {
  getOutputPath: () => string
  setOutputPath: (path: string) => void
  getOutputZipName: () => string
  setOutputZipName: (name: string) => void
}

export const createZipPublisher: PublisherFactory<ZipFactoryParams, ZipPublisher> = (
  params: ZipFactoryParams = {}
): ZipPublisher => {
  let { project, outputPath, outputZipName } = params

  const getProject = () => project
  const setProject = (projectToSet: GeneratedFolder) => {
    project = projectToSet
  }

  const getOutputPath = () => outputPath
  const setOutputPath = (path: string) => {
    outputPath = path
  }

  const getOutputZipName = () => outputZipName
  const setOutputZipName = (name: string) => {
    outputZipName = name
  }

  const publish = async (options: ZipFactoryParams = {}) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const projectOutputPath = options.outputPath || outputPath
    const projectOutputZipName = options.outputZipName || outputZipName

    try {
      const zipContent = await generateProjectZip(projectToPublish)

      if (projectOutputPath && isNodeProcess()) {
        const zipName = projectOutputZipName || projectToPublish.name
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
    getOutputZipName,
    setOutputZipName,
  }
}

export default createZipPublisher()
