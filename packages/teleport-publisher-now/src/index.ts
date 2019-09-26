import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-types'
import { NO_PROJECT_UIDL, NO_ACCESS_TOKEN } from './errors'
import { publishToNow, generateProjectFiles } from './utils'

export interface NowFactoryParams extends PublisherFactoryParams {
  accessToken: string
}

export interface NowPublisher extends Publisher<NowFactoryParams, string> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
}

const defaultPublisherParams: NowFactoryParams = {
  accessToken: null,
}

export const createNowPublisher: PublisherFactory<NowFactoryParams, NowPublisher> = (
  params: NowFactoryParams = defaultPublisherParams
): NowPublisher => {
  let { project, accessToken } = params

  const getProject = (): GeneratedFolder => project
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const getAccessToken = (): string => accessToken
  const setAccessToken = (token: string) => {
    accessToken = token
  }

  const publish = async (options: NowFactoryParams = defaultPublisherParams) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const nowAccessToken = options.accessToken || accessToken
    if (!nowAccessToken) {
      return { success: false, payload: NO_ACCESS_TOKEN }
    }

    try {
      const projectFiles = generateProjectFiles(projectToPublish)
      const nowUrl = await publishToNow(projectFiles, nowAccessToken)
      return { success: true, payload: nowUrl }
    } catch (error) {
      return { success: false, payload: error.message }
    }
  }

  return {
    publish,
    getProject,
    setProject,
    getAccessToken,
    setAccessToken,
  }
}
