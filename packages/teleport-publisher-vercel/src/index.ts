import {
  GeneratedFolder,
  PublisherFactory,
  Publisher,
  PublisherFactoryParams,
  VercelDeployResponse,
  MissingProjectUIDLError,
  VercelMissingTokenError,
} from '@teleporthq/teleport-types'
import { generateProjectFiles, createDeployment, checkDeploymentStatus } from './utils'
import { VercelPayload } from './types'

const defaultPublisherParams: VercelPublisherParams = {
  accessToken: null,
  projectSlug: 'teleport',
  version: 2,
  public: true,
  target: 'production',
  alias: [],
  individualUpload: false,
}

export interface VercelPublisherParams extends PublisherFactoryParams {
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

export interface VercelPublisher extends Publisher<VercelPublisherParams, VercelDeployResponse> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
}

export const createVercelPublisher: PublisherFactory<VercelPublisherParams, VercelPublisher> = (
  params: VercelPublisherParams = defaultPublisherParams
): VercelPublisher => {
  let { project, accessToken } = params

  const getProject = (): GeneratedFolder => project
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const getAccessToken = (): string => accessToken
  const setAccessToken = (token: string) => {
    accessToken = token
  }

  const publish = async (options?: VercelPublisherParams) => {
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
      accessToken: vercelAccessToken,
      public: publicDeploy,
      version,
      target,
      alias,
      individualUpload,
    } = publishOptions

    if (!vercelAccessToken) {
      throw new VercelMissingTokenError()
    }

    const files = await generateProjectFiles(projectToPublish, vercelAccessToken, individualUpload)

    const vercelPayload: VercelPayload = {
      files,
      name: projectSlug.toLowerCase(), // to avoid any vercel error
      version,
      public: publicDeploy,
      target,
      projectSettings: {
        framework: 'nextjs',
      },
    }

    vercelPayload.alias =
      alias.length === 0 && domainAlias ? [`${projectSlug}.${domainAlias}`] : alias

    const deploymentResult = await createDeployment(vercelPayload, vercelAccessToken, teamId)

    // Makes requests to the deployment URL until the deployment is ready
    await checkDeploymentStatus(deploymentResult.url)

    // If productionAlias is empty, the deploymentURL is the fallback
    // TODO: return all links from vercel
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
