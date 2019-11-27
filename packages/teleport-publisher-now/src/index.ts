import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
  MissingProjectUIDLError,
  NowMissingTokenError,
} from '@teleporthq/teleport-types'
import { generateProjectFiles, createDeployment, checkDeploymentStatus } from './utils'
import { NowPayload } from './types'

export interface NowFactoryParams extends PublisherFactoryParams {
  accessToken: string
  projectSlug: string
  domainAlias?: string
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
      throw new MissingProjectUIDLError()
    }

    const nowAccessToken = options.accessToken || accessToken
    const projectSlug = options.projectSlug || params.projectSlug
    const domainAlias = options.domainAlias || params.domainAlias

    if (!nowAccessToken) {
      throw new NowMissingTokenError()
    }

    const productionAlias = domainAlias ? `${projectSlug}.${domainAlias}` : null
    const nowPayload: NowPayload = {
      files: generateProjectFiles(projectToPublish),
      name: projectSlug,
      public: true,
      version: 2,
      target: 'production',
    }

    // send the production alias if it exists
    if (productionAlias) {
      nowPayload.alias = [productionAlias]
    }

    const deploymentURL = await createDeployment(nowPayload, nowAccessToken)

    // Makes requests to the deployment URL until the deployment is ready
    await checkDeploymentStatus(deploymentURL)

    // If productionAlias is empty, the deploymentURL is the fallback
    return { success: true, payload: 'https://' + (productionAlias || deploymentURL) }
  }

  return {
    publish,
    getProject,
    setProject,
    getAccessToken,
    setAccessToken,
  }
}
