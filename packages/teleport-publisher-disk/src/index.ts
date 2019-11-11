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
  projectSlug?: string
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
    const overrideProjectSlug = options.projectSlug || params.projectSlug
    const createProjectFolder = options.createProjectFolder || params.createProjectFolder

    if (overrideProjectSlug) {
      projectToPublish.name = overrideProjectSlug
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
