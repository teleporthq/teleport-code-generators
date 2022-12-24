import {
  GeneratedFolder,
  PublisherFactory,
  ServiceAuth,
  MissingProjectUIDLError,
  GithubMissingAuthError,
  GithubMissingRepoError,
  GithubInvalidTokenError,
  GithubUnexpectedError,
  GithubServerError,
} from '@teleporthq/teleport-types'

import { publishToGithub, generateProjectFiles } from './utils'
import { GithubFactoryParams, GithubPublisher, GithubPublishMeta } from './types'

const createGithubPublisher: PublisherFactory<GithubFactoryParams, GithubPublisher> = (
  params: GithubFactoryParams = {}
): GithubPublisher => {
  const { authMeta } = params
  let { project, repository, repositoryOwner, mainBranch, commitBranch, commitMessage } = params

  const getProject = () => project
  const setProject = (projectToSet: GeneratedFolder) => {
    project = projectToSet
  }

  const getRepository = () => repository
  const setRepository = (repo: string) => {
    repository = repo
  }

  const getMainBranchName = () => mainBranch
  const setMainBranchName = (branch: string) => {
    mainBranch = branch
  }

  const getCommitBranchName = () => commitBranch
  const setCommitBranchName = (branch: string) => {
    commitBranch = branch
  }

  const getCommitMessage = () => commitMessage
  const setCommitMessage = (message: string) => {
    commitMessage = message
  }

  const getRepositoryOwner = () => repositoryOwner
  const setRepositoryOwner = (owner: string) => {
    repositoryOwner = owner
  }

  const publish = async (options: GithubFactoryParams = {}) => {
    const projectToPublish = options.project || project
    if (!projectToPublish) {
      throw new MissingProjectUIDLError()
    }

    const auth = options.authMeta || authMeta
    if (!auth) {
      throw new GithubMissingAuthError()
    }

    const repo = options.repository || repository
    if (!repo) {
      throw new GithubMissingRepoError()
    }

    const repoOwner = findRepositoryOwner(auth, options)

    const mainBranchName = options.mainBranch || mainBranch
    const main = mainBranchName ? mainBranch : 'main'
    const commitBranchName = options.commitBranch || commitBranch
    const commitMsg = options.commitMessage || commitMessage
    const isPrivate = options.isPrivate || false

    const githubPublishMeta: GithubPublishMeta = {
      isPrivate,
      authMeta: auth,
      mainBranch: main,
      commitBranch: commitBranchName ? commitBranchName : main,
      commitMessage: commitMsg,
      repository: repo,
      repositoryOwner: repoOwner,
      extraBranchParents: options.extraBranchParents || [],
    }

    const projectFiles = generateProjectFiles({ folder: projectToPublish, ignoreFolder: true })

    try {
      const result = await publishToGithub(projectFiles, githubPublishMeta)
      return { success: true, payload: result }
    } catch (err) {
      // A bit hacky here, the github library we are using is failing with a TypeError when the service is down
      if (err instanceof TypeError) {
        throw new GithubServerError()
      }

      if (err.response.status === 401 && err.response.statusText === 'Unauthorized') {
        throw new GithubInvalidTokenError()
      }

      throw new GithubUnexpectedError(err)
    }
  }

  const findRepositoryOwner = (auth: ServiceAuth, options: GithubFactoryParams): string => {
    if (auth && auth.basic && auth.basic.username) {
      return auth.basic.username
    }
    return options.repositoryOwner || repositoryOwner
  }

  return {
    getProject,
    setProject,
    getRepository,
    setRepository,
    getMainBranchName,
    setMainBranchName,
    getCommitBranchName,
    setCommitBranchName,
    getCommitMessage,
    setCommitMessage,
    getRepositoryOwner,
    setRepositoryOwner,
    publish,
  }
}

export { createGithubPublisher, GithubFactoryParams, GithubPublishMeta, GithubPublisher }
