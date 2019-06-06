import { GeneratedFolder, PublisherFactory, GithubAuthMeta } from '@teleporthq/teleport-types'

import { publishToGithub, generateProjectFiles } from './utils'
import { GithubFactoryParams, GithubPublisher, GithubPublishMeta } from './types'

import { NO_PROJECT_UIDL, NO_REPO, NO_AUTH, NO_REPO_OWNER } from './errors'

export const createGithubPublisher: PublisherFactory<GithubFactoryParams, GithubPublisher> = (
  params: GithubFactoryParams = {}
): GithubPublisher => {
  const { authMeta } = params
  let { project, repository, repositoryOwner, masterBranch, commitBranch, commitMessage } = params

  const getProject = () => project
  const setProject = (projectToSet: GeneratedFolder) => {
    project = projectToSet
  }

  const getRepository = () => repository
  const setRepository = (repo: string) => {
    repository = repo
  }

  const getMasterBranchName = () => masterBranch
  const setMasterBranchName = (branch: string) => {
    masterBranch = branch
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
      return { success: false, payload: NO_PROJECT_UIDL }
    }

    const auth = options.authMeta || authMeta
    if (!auth) {
      return { success: false, payload: NO_AUTH }
    }

    const repo = options.repository || repository
    if (!repo) {
      return { success: false, payload: NO_REPO }
    }

    const repoOwner = findRepositoryOwner(auth, options)
    if (!repoOwner) {
      return { success: false, payload: NO_REPO_OWNER }
    }

    const masterBranchName = options.masterBranch || masterBranch
    const master = masterBranchName ? masterBranch : 'master'
    const commitBranchName = options.commitBranch || commitBranch
    const commitMsg = options.commitMessage || commitMessage

    try {
      const githubPublishMeta: GithubPublishMeta = {
        authMeta: auth,
        masterBranch: master,
        commitBranch: commitBranchName ? commitBranchName : master,
        commitMessage: commitMsg,
        repository: repo,
        repositoryOwner: repoOwner,
      }

      const projectFiles = generateProjectFiles({ folder: projectToPublish, ignoreFolder: true })

      const result = await publishToGithub(projectFiles, githubPublishMeta)
      return { success: true, payload: result }
    } catch (error) {
      return { success: false, payload: error.message }
    }
  }

  const findRepositoryOwner = (auth: GithubAuthMeta, options: GithubFactoryParams): string => {
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
    getMasterBranchName,
    setMasterBranchName,
    getCommitBranchName,
    setCommitBranchName,
    getCommitMessage,
    setCommitMessage,
    getRepositoryOwner,
    setRepositoryOwner,
    publish,
  }
}

export default createGithubPublisher()
