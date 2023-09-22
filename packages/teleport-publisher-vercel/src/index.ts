import {
  GeneratedFolder,
  PublisherFactory,
  Publisher,
  PublisherFactoryParams,
  VercelDeployResponse,
  MissingProjectUIDLError,
  VercelMissingTokenError,
  VercelDeleteProject,
} from '@teleporthq/teleport-types'
import {
  generateProjectFiles,
  createDeployment,
  checkDeploymentStatus,
  removeProject,
} from './utils'
import { VercelPayload } from './types'

const defaultPublisherParams: VercelPublisherParams = {
  accessToken: null,
  projectSlug: 'teleport',
  version: 2,
  public: true,
  target: 'production',
  alias: [],
  individualUpload: false,
  framework: 'nextjs',
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
  framework?: string
}

export interface VercelPublisher extends Publisher<VercelPublisherParams, VercelDeployResponse> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
  deleteProject: (options?: VercelDeleteProject) => Promise<boolean>
  checkDeploymentStatus: (deploymentURL: string, teamId?: string) => Promise<void>
}

export const createVercelPublisher: PublisherFactory<VercelPublisherParams, VercelPublisher> = (
  params: VercelPublisherParams
): VercelPublisher => {
  let { project, accessToken } = { ...defaultPublisherParams, ...(params && params) }
  const { framework } = { ...defaultPublisherParams, ...(params && params) }

  const getProject = (): GeneratedFolder => project
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const getAccessToken = (): string => accessToken
  const setAccessToken = (token: string) => {
    accessToken = token
  }

  const deleteProject = async (options?: VercelDeleteProject): Promise<boolean> => {
    const publishOptions = {
      ...defaultPublisherParams,
      ...params,
      ...options,
    }
    return removeProject(
      publishOptions.accessToken,
      publishOptions.projectSlug,
      publishOptions.teamId
    )
  }

  const publish = async (options?: VercelPublisherParams) => {
    const publishOptions = {
      ...defaultPublisherParams,
      ...params,
      ...options,
    }

    const projectToPublish = options?.project || project
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

    console.info(`[PUBLISHER-VERCEL] Uploading files to Vercel`)
    const files = await generateProjectFiles(
      projectToPublish,
      vercelAccessToken,
      individualUpload,
      teamId
    )

    const vercelPayload: VercelPayload = {
      files,
      name: projectSlug.toLowerCase(), // to avoid any vercel error
      version,
      public: publicDeploy,
      target,
      projectSettings: {
        framework: publishOptions?.framework || framework,
      },
    }

    vercelPayload.alias =
      alias.length === 0 && domainAlias ? [`${projectSlug}.${domainAlias}`] : alias

    console.info(`[PUBLISHER-VERCEL] Creating deployment`)
    const deploymentResult = await createDeployment(vercelPayload, vercelAccessToken, teamId)

    return { success: true, payload: deploymentResult }
  }

  return {
    publish,
    deleteProject,
    getProject,
    setProject,
    getAccessToken,
    setAccessToken,
    checkDeploymentStatus,
  }
}
