import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-types'
import { NO_PROJECT_UIDL } from './errors'
import { generateProjectFiles, publishToNow, checkDeploymentStatus } from './utils'

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

    try {
      const projectFiles = generateProjectFiles(projectToPublish)
      const deploymentURL = await publishToNow(projectFiles, nowAccessToken)

      // If the user did not provide the now token, we are using the teleport one so we wait for the deployment
      if (!nowAccessToken) {
        await checkDeploymentStatus(deploymentURL)
      }

      return { success: true, payload: 'https://' + deploymentURL }
    } catch (error) {
      return { success: false, payload: error }
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
