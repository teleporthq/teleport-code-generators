import {
  GeneratedFolder,
  PublisherFactory,
  Publisher,
  PublisherFactoryParams,
  NowDeployResponse,
  MissingProjectUIDLError,
  NowMissingTokenError,
} from '@teleporthq/teleport-types'
import { generateProjectFiles, createDeployment, checkDeploymentStatus } from './utils'
import { NowPayload } from './types'

const defaultPublisherParams: NowPublisherParams = {
  accessToken: null,
  projectSlug: 'teleport',
  version: 2,
  public: true,
  target: 'production',
  alias: [],
  individualUpload: false,
}

export interface NowPublisherParams extends PublisherFactoryParams {
  accessToken: string
  projectSlug: string
  domainAlias?: string
  teamId?: string
  version?: number
  public?: boolean
  target?: string
  alias?: string[]
  individualUpload?: boolean
}

export interface NowPublisher extends Publisher<NowPublisherParams, NowDeployResponse> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
}

export const createNowPublisher: PublisherFactory<NowPublisherParams, NowPublisher> = (
  params: NowPublisherParams = defaultPublisherParams
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

  const publish = async (options?: NowPublisherParams) => {
    const publishOptions = {
      ...defaultPublisherParams,
      ...params,
      ...options,
    }

    const projectToPublish = options.project || project
    if (!projectToPublish) {
      throw new MissingProjectUIDLError()
    }

    const {
      projectSlug,
      domainAlias,
      teamId,
      accessToken: nowAccessToken,
      public: publicDeploy,
      version,
      target,
      alias,
      individualUpload,
    } = publishOptions

    if (!nowAccessToken) {
      throw new NowMissingTokenError()
    }

    const files = await generateProjectFiles(projectToPublish, nowAccessToken, individualUpload)

    const nowPayload: NowPayload = {
      files,
      name: projectSlug.toLowerCase(), // to avoid any now error
      version,
      public: publicDeploy,
      target,
    }

    nowPayload.alias = alias.length === 0 && domainAlias ? [`${projectSlug}.${domainAlias}`] : alias

    const deploymentResult = await createDeployment(nowPayload, nowAccessToken, teamId)

    // Makes requests to the deployment URL until the deployment is ready
    await checkDeploymentStatus(deploymentResult.url)

    // If productionAlias is empty, the deploymentURL is the fallback
    // TODO: return all links from now
    return { success: true, payload: deploymentResult }
  }

  return {
    publish,
    getProject,
    setProject,
    getAccessToken,
    setAccessToken,
  }
}
