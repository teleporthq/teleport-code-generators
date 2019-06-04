import { GithubAuthMeta, GeneratedFolder } from '@teleporthq/teleport-types'
import GithubInstance from './github-instance'

export type GithubGatewayFactory = (auth?: GithubAuthMeta) => GithubGateway

export interface GithubGateway {
  getRepository: (repo: RepositoryIdentity, auth?: GithubAuthMeta) => Promise<GeneratedFolder>
  getUserRepositories: (username: string, auth?: GithubAuthMeta) => Promise<GithubRepositoryData[]>
  commitFilesToRepo: (commitMeta: GithubCommitMeta, auth?: GithubAuthMeta) => Promise<string>
  createRepository: (
    repository: NewRepository,
    auth?: GithubAuthMeta
  ) => Promise<GithubRepositoryData>
}

export interface RepositoryIdentity {
  username: string
  repo: string
  ref?: string
  path?: string
}

export interface GithubCommitMeta {
  files: GithubFile[]
  repositoryIdentity: RepositoryIdentity
  branchName: string
  commitMessage?: string
}

export interface RepositoryContentResponse {
  data: GithubFile | GithubFile[]
  status: number
}

export interface GithubFile {
  content: string
  name: string
  path?: string
  encoding?: string
  type?: string
  url?: string
  git_url?: string
  sha?: string
  size?: number
}

export interface GithubFileMeta {
  sha: string
  path: string
  mode: string
  type: string
  encoding?: string
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

export interface GithubRepository {
  __fullname: string
  getContents: (ref: string, path: string) => Promise<RepositoryContentResponse>
  listBranches: () => Promise<GithubBranchesResponse>
  createBranch: (ref: string, branchName: string) => Promise<GithubCreateResponse>
  getRef: (url: string) => Promise<GithubGetRefResponse>
  getCommit: (sha: string) => Promise<GithubGetCommitResponse>
  createTree: (files: GithubFileMeta[], sha?: string) => Promise<GithubCreateResponse>
  commit: (parentSHA: string, treeSHA: string, message: string) => Promise<GithubCreateResponse>
  updateHead: (ref: string, commitSHA: string) => Promise<void>
  createBlob: (fileContent: string) => Promise<GithubCreateResponse>
}

export interface GithubCreateResponse {
  data: {
    sha: string
  }
}

interface GithubBranchesResponse {
  data: Array<Record<string, string>>
}

interface GithubGetRefResponse {
  data: {
    object: {
      sha: string
    }
  }
}

interface GithubGetCommitResponse {
  data: {
    tree: {
      sha: string
    }
  }
}
