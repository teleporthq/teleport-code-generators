import { ServiceAuth } from '@teleporthq/teleport-types'

import GithubInstance from './github-instance'
import { createEmptyFolder, fetchFilesContent } from './utils'

import {
  GithubGatewayFactory,
  RepositoryIdentity,
  GithubFile,
  NewRepository,
  GithubCommitMeta,
  RepositoryCommitsListMeta,
  RepositoryCommitMeta,
  CreateBranchMeta,
  RepositoryMergeMeta,
  RemoveBranchMeta,
} from './types'

export const createGithubGateway: GithubGatewayFactory = (auth: ServiceAuth = {}) => {
  const githubInstance = new GithubInstance(auth)

  const getRepository = async (repoIdentity: RepositoryIdentity, authData?: ServiceAuth) => {
    authorizeGithubInstance(authData)

    const data = await githubInstance.getRepoContent(repoIdentity)

    const { repo } = repoIdentity
    const emptyFolder = createEmptyFolder(repo)

    const filesFetcherMeta = { githubInstance, userRepositoryIdentity: repoIdentity }
    return fetchFilesContent(data as GithubFile[], emptyFolder, filesFetcherMeta)
  }

  const getUserRepositories = async (authData?: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.getUserRepositories()
  }

  const createRepository = async (repository: NewRepository, authData?: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.createRepository(repository)
  }

  const commitFilesToRepo = async (commitMeta: GithubCommitMeta, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.commitFilesToRepo(commitMeta)
  }

  const getRepositoryCommits = async (meta: RepositoryCommitsListMeta, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.getRepositoryCommits(meta)
  }

  const createBranch = async (meta: CreateBranchMeta, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.createBranch(meta)
  }

  const mergeRepositoryBranches = async (meta: RepositoryMergeMeta, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.mergeRepositoryBranches(meta)
  }

  const getRepositoryBranches = async (owner: string, repo: string, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.getRepositoryBranches(owner, repo)
  }

  const deleteRepositoryBranch = async (meta: RemoveBranchMeta, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.deleteBranch(meta)
  }

  const getCommitData = async (meta: RepositoryCommitMeta, authData: ServiceAuth) => {
    authorizeGithubInstance(authData)
    return githubInstance.getCommitData(meta)
  }

  const authorizeGithubInstance = (authData?: ServiceAuth): void => {
    if (!authData) {
      return
    }
    githubInstance.authorize(authData)
  }

  return {
    getRepository,
    getUserRepositories,
    createRepository,
    getRepositoryCommits,
    createBranch,
    getRepositoryBranches,
    mergeRepositoryBranches,
    deleteRepositoryBranch,
    commitFilesToRepo,
    getCommitData,
    authorizeGithubInstance,
  }
}

export { GithubFile, RepositoryIdentity, GithubCommitMeta, CreateBranchMeta, RepositoryCommitMeta }
