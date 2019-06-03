import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-types'
import { NO_PROJECT_UIDL, NO_DEPLOY_TOKEN } from './errors'
import { publishToNow, generateProjectFiles } from './utils'

export interface NowFactoryParams extends PublisherFactoryParams {
  deployToken: string
}

export interface NowPublisher extends Publisher<NowFactoryParams, string> {
  getDeployToken: () => string
  setDeployToken: (token: string) => void
}

const defaultPublisherParams = {
  deployToken: null,
}

export const createNowPublisher: PublisherFactory<NowFactoryParams, NowPublisher> = (
  params: NowFactoryParams = defaultPublisherParams
): NowPublisher => {
  let { project, deployToken } = params

  const getProject = (): GeneratedFolder => project
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const getDeployToken = (): string => deployToken
  const setDeployToken = (token: string) => {
    deployToken = token
  }

  const publish = async (options: NowFactoryParams = defaultPublisherParams) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const nowDeployToken = options.deployToken || deployToken
    if (!nowDeployToken) {
      return { success: false, payload: NO_DEPLOY_TOKEN }
    }

    try {
      const projectFiles = generateProjectFiles(projectToPublish)
      const nowUrl = await publishToNow(projectFiles, nowDeployToken)
      return { success: true, payload: nowUrl }
    } catch (error) {
      return { success: false, payload: error.message }
    }
  }

  return {
    publish,
    getProject,
    setProject,
    getDeployToken,
    setDeployToken,
  }
}

export default createNowPublisher()
