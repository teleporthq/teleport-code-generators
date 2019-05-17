import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { writeFolder } from './utils'
import { NO_PROJECT_UIDL, NO_OUTPUT_PATH } from './errors'

export interface DiskFactoryParams extends PublisherFactoryParams {
  outputPath?: string
}

export interface DiskPublisher extends Publisher<DiskFactoryParams, string> {
  getOutputPath: () => string
  setOutputPath: (path: string) => void
}

const defaultPublisherParams = {
  outputPath: null,
}

const createDiskPublisher: PublisherFactory<DiskFactoryParams, DiskPublisher> = (
  params: DiskFactoryParams = defaultPublisherParams
): DiskPublisher => {
  let { project, outputPath } = params

  const getProject = (): GeneratedFolder => {
    return project
  }
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const getOutputPath = (): string => {
    return outputPath
  }
  const setOutputPath = (path: string): void => {
    outputPath = path
  }

  const publish = async (options: DiskFactoryParams = defaultPublisherParams) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const projectOutputPath = options.outputPath || outputPath
    if (!projectOutputPath) {
      return { success: false, payload: NO_OUTPUT_PATH }
    }

    try {
      await writeFolder(projectToPublish, projectOutputPath)
      return { success: true, payload: projectOutputPath }
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

export default createDiskPublisher
