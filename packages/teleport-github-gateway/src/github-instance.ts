// @ts-ignore
import Github from 'github-api'
import fetch from 'cross-fetch'

import { ServiceAuth } from '@teleporthq/teleport-types'

import {
  DEFAULT_REF,
  DEFAULT_PATH,
  DEFAULT_COMMIT_MESSAGE,
  GITHUB_REPOSITORY_BASE_URL,
} from './constants'

import {
  RepositoryContentResponse,
  GithubFileMeta,
  GithubRepositoryData,
  NewRepository,
  GithubRepository,
  GithubCommitMeta,
  RepositoryIdentity,
  GithubFile,
  RepositoryCommitsListMeta,
  RepositoryCommitMeta,
  CreateBranchMeta,
} from './types'
import { createBase64GithubFileBlob } from './utils'

export default class GithubInstance {
  // @ts-ignore
  private githubApi = null
  private auth: ServiceAuth = null

  constructor(auth: ServiceAuth = {}) {
    this.authorize(auth)
  }

  public authorize(auth: ServiceAuth = {}) {
    this.auth = auth

    if (auth.basic) {
      this.githubApi = new Github({ ...auth.basic })
      return
    }

    if (auth.token) {
      this.githubApi = new Github({ token: auth.token })
      return
    }

    this.githubApi = new Github()
  }

  public async getRepoContent(
    repoIdentity: RepositoryIdentity
  ): Promise<RepositoryContentResponse> {
    const { username, repo, ref = DEFAULT_REF, path = DEFAULT_PATH } = repoIdentity

    const repository = await this.githubApi.getRepo(username, repo)
    return repository.getContents(ref, path)
  }

  public async getUserRepositories(): Promise<GithubRepositoryData[]> {
    const user = await this.githubApi.getUser()
    const { data } = await user.listRepos()
    return data
  }

  public async createBranch(meta: CreateBranchMeta) {
    const { repo, owner, sourceBranch, newBranch } = meta
    const repository = await this.githubApi.getRepo(owner, repo)
    if (!repository) {
      throw new Error('Repository does not exist')
    }

    return repository.createBranch(sourceBranch, newBranch)
  }

  public async createRepository(repository: NewRepository): Promise<GithubRepositoryData> {
    const { meta } = repository
    const user = await this.githubApi.getUser()

    // Auto initialize repository by creating an initial commit with empty README
    if (typeof meta.auto_init === 'undefined' || meta.auto_init === null) {
      meta.auto_init = true
    }

    const { data } = await user.createRepo(meta)
    return data
  }

  public async getRepositoryCommits(meta: RepositoryCommitsListMeta) {
    const { owner, repo } = meta
    const repository = await this.githubApi.getRepo(owner, repo)
    if (!repository) {
      throw new Error('Repository does not exist')
    }

    const params = {
      ...meta,
      per_page: meta.perPage ?? undefined,
    }

    return repository.listCommits(params)
  }

  public async getCommitData(meta: RepositoryCommitMeta) {
    const { owner, repo, ref } = meta
    const repository = await this.githubApi.getRepo(owner, repo)
    if (!repository) {
      throw new Error('Repository does not exist')
    }

    const commitDetails = await repository.getSingleCommit(ref)

    const fileContentPromises = commitDetails.data.files.map(async (file: { raw_url: string }) => {
      const response = await fetch(file.raw_url)
      return response.text()
    })
    const fileContents = await Promise.all(fileContentPromises)

    commitDetails.data.files.forEach((file: { content?: string }, index: number) => {
      file.content = fileContents[index] as string
    })

    return commitDetails
  }

  public async getRepositoryBranches(owner: string, repo: string) {
    const repository = await this.githubApi.getRepo(owner, repo)
    if (!repository) {
      throw new Error('Repository does not exist')
    }
    return repository.listBranches()
  }

  public async commitFilesToRepo(commitMeta: GithubCommitMeta): Promise<string> {
    const {
      branchName,
      isPrivate,
      files,
      repositoryIdentity,
      commitMessage = DEFAULT_COMMIT_MESSAGE,
    } = commitMeta
    const { repo, ref = DEFAULT_REF } = repositoryIdentity

    // Step -1: Make a separate request for the username if it is not provided
    let username = repositoryIdentity.username
    if (!username) {
      const user = await this.githubApi.getUser()
      const profile = await user.getProfile()
      username = profile.data.login
    }

    // Step 0: Create repository if it does not exist
    await this.ensureRepoExists(username, repo, isPrivate)
    const repository: GithubRepository = await this.githubApi.getRepo(username, repo)

    // Step 1: Create branch if it does not exist
    await this.ensureBranchExists(repository, ref, branchName)

    // Step 2: Get branch commit SHA
    const commitSHA = await this.getBranchHeadCommitSHA(repository, branchName)

    // Step 3: Get current tree SHA
    const treeSHA = await this.getCommitTreeSHA(repository, commitSHA)

    // Step 4: Prepare files for github
    const filesForGithub = await this.createFiles(repository, files)

    // Step 5: Create new github tree
    const newTreeSHA = await this.createTree(repository, filesForGithub, treeSHA)

    // Step 6: Create commit
    const newCommit = await repository.commit(commitSHA, newTreeSHA, commitMessage)
    const newCommitSHA = newCommit.data.sha

    // Step 7: Update head
    await repository.updateHead(`heads/${branchName}`, newCommitSHA)

    return `${GITHUB_REPOSITORY_BASE_URL}/${repository.__fullname}`
  }

  private async ensureRepoExists(
    username: string,
    repo: string,
    isPrivate: boolean
  ): Promise<void> {
    const repositories = await this.getUserRepositories()
    const repoExists = repositories.some((repoMeta: GithubRepositoryData) => repoMeta.name === repo)

    if (!repoExists) {
      await this.createRepository({ username, meta: { name: repo, private: isPrivate } })
    }
  }

  private async ensureBranchExists(
    repo: GithubRepository,
    ref: string,
    branch: string
  ): Promise<void> {
    const { data } = await repo.listBranches()
    const branchExists = data.some((branchMeta) => branchMeta.name === branch)

    if (!branchExists) {
      await repo.createBranch(ref, branch)
    }
  }

  private async getBranchHeadCommitSHA(repo: GithubRepository, branch: string): Promise<string> {
    const { data } = await repo.getRef(`heads/${branch}`)
    return data.object.sha
  }

  private async getCommitTreeSHA(repo: GithubRepository, commitSHA: string): Promise<string> {
    const { data } = await repo.getCommit(commitSHA)
    return data.tree.sha
  }

  private async createFiles(
    repo: GithubRepository,
    files: GithubFile[]
  ): Promise<GithubFileMeta[]> {
    const promises = files.map((file) => {
      return this.createFile(repo, file)
    })

    return Promise.all(promises)
  }

  private async createFile(repo: GithubRepository, file: GithubFile): Promise<GithubFileMeta> {
    const { data } =
      file.encoding === 'base64'
        ? await createBase64GithubFileBlob(file, repo.__fullname, this.auth)
        : await repo.createBlob(file.content)

    return {
      sha: file.status === 'deleted' ? null : data.sha,
      path: file.name,
      mode: '100644',
      type: 'blob',
    }
  }

  private async createTree(
    repo: GithubRepository,
    files: GithubFileMeta[],
    treeSHA?: string
  ): Promise<string> {
    const tree = await repo.createTree(files, treeSHA)
    return tree.data.sha
  }
}
