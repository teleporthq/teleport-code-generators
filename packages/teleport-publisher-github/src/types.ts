import {
  ServiceAuth,
  PublisherFactoryParams,
  Publisher,
  GeneratedFolder,
} from '@teleporthq/teleport-types'
import { GithubFile } from '@teleporthq/teleport-github-gateway'

export interface GithubFactoryParams extends PublisherFactoryParams {
  authMeta?: ServiceAuth
  repositoryOwner?: string
  repository?: string
  masterBranch?: string
  commitBranch?: string
  commitMessage?: string
}

export interface GithubPublisher extends Publisher<GithubFactoryParams, string> {
  getRepository: () => string
  setRepository: (repo: string) => void
  getMasterBranchName: () => string
  setMasterBranchName: (branch: string) => void
  getCommitBranchName: () => string
  setCommitBranchName: (branch: string) => void
  getCommitMessage: () => string
  setCommitMessage: (message: string) => void
  getRepositoryOwner: () => string
  setRepositoryOwner: (owner: string) => void
}

export interface GithubPublishMeta {
  authMeta: ServiceAuth
  repository: string
  repositoryOwner: string
  masterBranch?: string
  commitBranch?: string
  commitMessage?: string
}

export interface ProjectFolderInfo {
  folder: GeneratedFolder
  prefix?: string
  files?: GithubFile[]
  ignoreFolder?: boolean
}
