import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  PublisherFactoryParams,
  PublisherFactory,
  Publisher,
  MissingProjectUIDLError,
  CodeSandboxProjectTooBigError,
  CodeSandboxServerError,
  CodeSandboxUnexpectedError,
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

    if (!folder) {
      throw new MissingProjectUIDLError()
    }

    const flatProject = convertToCodesandboxStructure(folder)

    const response = await fetch(`${BASE_URL}?json=1`, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ files: flatProject }),
    })

    if (response.status >= 500) {
      throw new CodeSandboxServerError()
    }

    const result = await response.json()

    if (response.status === 200 && result.sandbox_id) {
      return { success: true, payload: `${BASE_SANDBOX_URL}${result.sandbox_id}` }
    }

    if (
      response.status === 422 &&
      Array.isArray(result.errors.detail) &&
      result.errors.detail.includes('request entity too large')
    ) {
      throw new CodeSandboxProjectTooBigError()
    }

    throw new CodeSandboxUnexpectedError(result.errors)
  }

  return {
    getProject,
    setProject,
    publish,
  }
}
