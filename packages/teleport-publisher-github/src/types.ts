import {
  GithubAuthMeta,
  PublisherFactoryParams,
  Publisher,
  GeneratedFolder,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { GithubFile } from '../../teleport-github-gateway/lib/types'

export interface GithubFactoryParams extends PublisherFactoryParams {
  authMeta?: GithubAuthMeta
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
  authMeta: GithubAuthMeta
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
