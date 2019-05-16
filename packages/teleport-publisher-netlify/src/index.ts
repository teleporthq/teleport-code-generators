import {
  GeneratedFolder,
  Publisher,
  PublisherFactoryParams,
  PublisherFactory,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { BUILD_COMMAND, PUBLISH_DIRECTORY } from './constants'
import { NO_PROJECT_UIDL, NO_ACCESS_TOKEN } from './errors'
import { deployToNetlify } from './netlifyClient'
// import { DUMMY_PROJECT } from './dummyProj'

export interface NetlifyFactoryParams extends PublisherFactoryParams {
  accessToken: string
  buildCommand?: string
  publishDirectory?: string
}

export interface NetlifyPublisher extends Publisher<NetlifyFactoryParams, string> {
  getAccessToken: () => string
  setAccessToken: (token: string) => void
}

const defaultPublisherParams = {
  accessToken: null,
  buildCommand: BUILD_COMMAND,
  publishDirectory: PUBLISH_DIRECTORY,
}

const createNetlifyPublisher: PublisherFactory<NetlifyFactoryParams, NetlifyPublisher> = (
  params: NetlifyFactoryParams = defaultPublisherParams
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

  // const getBuildCommand = (): string => buildCommand
  // const setBuildCommand = (command: string): void => {
  //   buildCommand = command
  // }

  // const getPublishDirectory = (): string => publishDirectory
  // const setPublishDirectory = (directory: string): void => {
  //   publishDirectory = directory
  // }

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
      return { success: false, payload: error }
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

export default createNetlifyPublisher

// const publisher = createNetlifyPublisher()

// publisher
//   .publish({
//     project: DUMMY_PROJECT,
//     accessToken: '3a07c4dec3b834593e2da9eaa02d7cb37dfb4f981a8311964d1cc21420a3d298',
//   })
//   .then((result) => {
//     console.log('result', result, '\n', result.payload.json)
//   })
//   .catch((error) => {
//     console.log('error', error)
//   })
