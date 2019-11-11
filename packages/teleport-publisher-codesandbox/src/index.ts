import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  PublisherFactoryParams,
  PublisherFactory,
  Publisher,
} from '@teleporthq/teleport-types'
import { BASE_URL, BASE_SANDBOX_URL } from './constants'
import { convertToCodesandboxStructure } from './utils'

export const createCodesandboxPublisher: PublisherFactory<
  PublisherFactoryParams,
  Publisher<PublisherFactoryParams, string>
> = (params = {}) => {
  let { project } = params

  const getProject = (): GeneratedFolder => project
  const setProject = (projectToSet: GeneratedFolder): void => {
    project = projectToSet
  }

  const publish = async (options: PublisherFactoryParams = {}) => {
    const folder = options.project || project

    const flatProject = convertToCodesandboxStructure(folder)

    try {
      const response = await fetch(`${BASE_URL}?json=1`, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({ files: flatProject }),
      })

      const result = await response.json()

      return { success: true, payload: `${BASE_SANDBOX_URL}${result.sandbox_id}` }
    } catch (error) {
      return { success: false, payload: error.message }
    }
  }

  return {
    getProject,
    setProject,
    publish,
  }
}
