import { GithubAuthMeta } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import GithubInstance from './github-instance'
import { createEmptyFolder, fetchFilesContent } from './utils'

import {
  GithubGatewayFactory,
  RepositoryIdentity,
  GithubFile,
  NewRepository,
  GithubCommitMeta,
} from './types'

export const createGithubGateway: GithubGatewayFactory = (auth: GithubAuthMeta = {}) => {
  const githubInstance = new GithubInstance(auth)

  const getRepository = async (repoIdentity: RepositoryIdentity, authData?: GithubAuthMeta) => {
    authorizeGithubInstance(authData)

    const { data } = await githubInstance.getRepoContent(repoIdentity)

    const { repo } = repoIdentity
    const emptyFolder = createEmptyFolder(repo)

    const filesFetcherMeta = { githubInstance, userRepositoryIdentity: repoIdentity }
    return fetchFilesContent(data as GithubFile[], emptyFolder, filesFetcherMeta)
  }

  const getUserRepositories = async (username: string, authData?: GithubAuthMeta) => {
    authorizeGithubInstance(authData)
    return githubInstance.getUserRepositories(username)
  }

  const createRepository = async (repository: NewRepository, authData?: GithubAuthMeta) => {
    authorizeGithubInstance(authData)
    return githubInstance.createRepository(repository)
  }

  const commitFilesToRepo = async (commitMeta: GithubCommitMeta, authData: GithubAuthMeta) => {
    authorizeGithubInstance(authData)
    return githubInstance.commitFilesToRepo(commitMeta)
  }

  const authorizeGithubInstance = (authData?: GithubAuthMeta): void => {
    if (!authData) {
      return
    }
    githubInstance.authorize(authData)
  }

  return {
    getRepository,
    getUserRepositories,
    createRepository,
    commitFilesToRepo,
  }
}

export default createGithubGateway()
