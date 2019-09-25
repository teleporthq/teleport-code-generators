import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-types'
import { BUILD_COMMAND, PUBLISH_DIRECTORY } from './constants'
import { NO_PROJECT_UIDL, NO_ACCESS_TOKEN } from './errors'
import { deployToNetlify } from './netlifyClient'

export interface NetlifyFactoryParams extends PublisherFactoryParams {
  accessToken: string
  buildCommand?: string
  publishDirectory?: string
}

export interface NetlifyPublisher extends Publisher<NetlifyFactoryParams, string> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
}

const defaultPublisherParams: NetlifyFactoryParams = {
  accessToken: null,
  buildCommand: BUILD_COMMAND,
  publishDirectory: PUBLISH_DIRECTORY,
}

export const createNetlifyPublisher: PublisherFactory<NetlifyFactoryParams, NetlifyPublisher> = (
  params = defaultPublisherParams
): NetlifyPublisher => {
  let { project, accessToken } = params

  const getAccessToken = (): string => accessToken
  const setAccessToken = (token: string): void => {
    accessToken = token
  }

  const getProject = (): GeneratedFolder => project
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const publish = async (options: NetlifyFactoryParams = defaultPublisherParams) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const netlifyAccessToken = options.accessToken || accessToken
    if (!netlifyAccessToken) {
      return { success: false, payload: NO_ACCESS_TOKEN }
    }

    try {
      const result = await deployToNetlify(projectToPublish, netlifyAccessToken)
      return { success: true, payload: result }
    } catch (error) {
      return { success: false, payload: error.message }
    }
  }

  return {
    getProject,
    setProject,
    getAccessToken,
    setAccessToken,
    publish,
  }
}
