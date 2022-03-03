/* tslint:disable no-any */
import { ServiceAuth, GeneratedFolder, FileEncoding } from '@teleporthq/teleport-types'
import GithubInstance from './github-instance'

export type GithubGatewayFactory = (auth?: ServiceAuth) => GithubGateway

export interface GithubGateway {
  getRepository: (repo: RepositoryIdentity, auth?: ServiceAuth) => Promise<GeneratedFolder>
  getUserRepositories: (auth?: ServiceAuth) => Promise<GithubRepositoryData[]>
  commitFilesToRepo: (commitMeta: GithubCommitMeta, auth?: ServiceAuth) => Promise<string>
  createRepository: (repository: NewRepository, auth?: ServiceAuth) => Promise<GithubRepositoryData>
  getRepositoryCommits: (meta: RepositoryCommitsListMeta, authData: ServiceAuth) => Promise<any>
  createBranch: (meta: CreateBranchMeta, authData: ServiceAuth) => Promise<any>
  mergeRepositoryBranches: (meta: RepositoryMergeMeta, authData: ServiceAuth) => Promise<any>
  deleteRepositoryBranch: (meta: RemoveBranchMeta, authData: ServiceAuth) => Promise<any>
  getRepositoryBranches: (owner: string, repo: string, authData: ServiceAuth) => Promise<any>
  getCommitData: (meta: RepositoryCommitMeta, authData: ServiceAuth) => Promise<any>
  authorizeGithubInstance: (authData?: ServiceAuth) => void
}

export interface RepositoryIdentity {
  owner: string
  repo: string
  ref?: string
  path?: string
}

export interface GithubCommitMeta {
  files: GithubFile[]
  repositoryIdentity: RepositoryIdentity
  branchName: string
  commitMessage?: string
  isPrivate?: boolean
}

export interface CreateBranchMeta {
  repo: string
  owner: string
  sourceBranch: string
  newBranch: string
}

export interface RepositoryCommitMeta {
  repo: string
  owner: string
  ref: string
}

export interface RepositoryCommitsListMeta {
  repo: string
  owner: string
  perPage?: number
  page?: number
  sha?: string
  path?: string
}

export interface RepositoryMergeMeta {
  repo: string
  owner: string
  base: string
  head: string
}

export interface RemoveBranchMeta {
  repo: string
  owner: string
  branch: string
}

export interface GithubFile {
  content: string
  name: string
  path?: string
  encoding?: FileEncoding
  type?: string
  url?: string
  git_url?: string
  sha?: string
  size?: number
  status?: string
}

export interface GithubFileMeta {
  sha: string
  path: string
  mode: string
  type: string
}

export interface NewRepository {
  username: string
  meta: {
    name: string
    description?: string
    private?: boolean
    auto_init?: boolean
  }
}

export interface GithubRepositoryData {
  id: number
  language: string
  license: Record<string, string>
  default_branch: string
  clone_url: string
  created_at: string
  description: string
  full_name: string
  name: string
}

export interface FilesFetcherMeta {
  userRepositoryIdentity: RepositoryIdentity
  githubInstance: GithubInstance
}

export interface GithubCreateResponse {
  data: {
    sha: string
  }
}
