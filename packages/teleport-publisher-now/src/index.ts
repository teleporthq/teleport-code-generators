import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-types'
import { NO_PROJECT_UIDL, NO_TOKEN } from './errors'
import { generateProjectFiles, createDeployment, checkDeploymentStatus } from './utils'
import { NowPayload } from './types'

export interface NowFactoryParams extends PublisherFactoryParams {
  accessToken: string
  projectSlug: string
}

export interface NowPublisher extends Publisher<NowFactoryParams, string> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
}

const defaultPublisherParams: NowFactoryParams = {
  accessToken: null,
  projectSlug: 'teleport',
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
    const projectSlug = options.projectSlug || params.projectSlug

    if (!nowAccessToken) {
      return { success: false, payload: NO_TOKEN }
    }

    try {
      const nowPayload: NowPayload = {
        files: generateProjectFiles(projectToPublish),
        name: projectSlug,
        public: true,
        version: 2,
        target: 'production',
      }
      const deploymentURL = await createDeployment(nowPayload, nowAccessToken)

      // Makes requests to the deployment URL until the deployment is ready
      await checkDeploymentStatus(deploymentURL)

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
