import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-types'

import { writeFolder } from './utils'
import { NO_PROJECT_UIDL } from './errors'

export interface DiskFactoryParams extends PublisherFactoryParams {
  outputPath?: string
  projectName?: string
  createProjectFolder?: boolean
}

export interface DiskPublisher extends Publisher<DiskFactoryParams, string> {
  getOutputPath: () => string
  setOutputPath: (path: string) => void
}

export const createDiskPublisher: PublisherFactory<DiskFactoryParams, DiskPublisher> = (
  params: DiskFactoryParams = {}
): DiskPublisher => {
  let { project, outputPath = './' } = params

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

  const publish = async (options: DiskFactoryParams = {}) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const projectOutputPath = options.outputPath || outputPath
    const overrideProjectName = options.projectName || params.projectName
    const createProjectFolder = options.createProjectFolder || params.createProjectFolder

    if (overrideProjectName) {
      projectToPublish.name = overrideProjectName
    }

    try {
      await writeFolder(projectToPublish, projectOutputPath, createProjectFolder)
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

export default createDiskPublisher()
