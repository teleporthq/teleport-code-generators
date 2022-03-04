import fetch from 'cross-fetch'
import { Octokit } from 'octokit'

import { ServiceAuth } from '@teleporthq/teleport-types'

import {
  DEFAULT_REF,
  DEFAULT_PATH,
  DEFAULT_COMMIT_MESSAGE,
  GITHUB_REPOSITORY_BASE_URL,
} from './constants'

import {
  GithubFileMeta,
  GithubRepositoryData,
  NewRepository,
  GithubCommitMeta,
  RepositoryIdentity,
  GithubFile,
  RepositoryCommitsListMeta,
  RepositoryCommitMeta,
  CreateBranchMeta,
  RepositoryMergeMeta,
  RemoveBranchMeta,
} from './types'
import { createBase64GithubFileBlob } from './utils'

export default class GithubInstance {
  private octokit: Octokit | null = null
  private auth: ServiceAuth = null

  constructor(auth: ServiceAuth = {}) {
    this.authorize(auth)
  }

  public authorize(auth: ServiceAuth = {}) {
    this.auth = auth

    if (auth.basic) {
      this.octokit = new Octokit({ auth: auth.basic })

      return
    }

    if (auth.token) {
      this.octokit = new Octokit({ auth: auth.token })
      return
    }

    this.octokit = new Octokit()
  }

  public async getRepoContent(
    repoIdentity: RepositoryIdentity
  ): Promise<GithubFile | GithubFile[]> {
    const { owner: username, repo, ref = DEFAULT_REF, path = DEFAULT_PATH } = repoIdentity

    const content = await this.octokit.rest.repos.getContent({ owner: username, repo, ref, path })
    return content.data as GithubFile | GithubFile[]
  }

  public async getUserRepositories(): Promise<GithubRepositoryData[]> {
    let page = 1
    const allRepos = []
    let currentPageRepos = await this.octokit.rest.repos.listForAuthenticatedUser({
      page,
      per_page: 50,
    })

    while (currentPageRepos.data.length) {
      page++
      allRepos.push(...currentPageRepos.data)
      currentPageRepos = await this.octokit.rest.repos.listForAuthenticatedUser({
        page,
        per_page: 50,
      })
    }

    return allRepos as GithubRepositoryData[]
  }

  public async createBranch(meta: CreateBranchMeta) {
    const { repo, owner, sourceBranch, newBranch } = meta
    const ref = await this.octokit.rest.git.getRef({ owner, repo, ref: `heads/${sourceBranch}` })

    const { data } = await this.octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: ref.data.object.sha,
    })

    return data
  }

  public async createRepository(repository: NewRepository): Promise<GithubRepositoryData> {
    const { meta } = repository

    // Auto initialize repository by creating an initial commit with empty README
    if (typeof meta.auto_init === 'undefined' || meta.auto_init === null) {
      meta.auto_init = true
    }

    const result = await this.octokit.rest.repos.createForAuthenticatedUser(meta)
    return result.data as GithubRepositoryData
  }

  public async getRepositoryCommits(meta: RepositoryCommitsListMeta) {
    const { owner, repo } = meta
    const repository = await this.octokit.rest.repos.get({ owner, repo })
    if (!repository) {
      throw new Error('Repository does not exist')
    }

    if (meta.page || meta.perPage) {
      const params = {
        ...meta,
        per_page: meta.perPage ?? undefined,
      }

      const commits = await this.octokit.rest.repos.listCommits(params)
      return commits.data
    }

    const allCommits = []
    let page = 1
    let currentPageCommits = await this.octokit.rest.repos.listCommits({
      ...meta,
      page,
      per_page: 50,
    })

    while (currentPageCommits.data.length) {
      page++
      allCommits.push(...currentPageCommits.data)
      currentPageCommits = await this.octokit.rest.repos.listCommits({
        ...meta,
        page,
        per_page: 50,
      })
    }

    return allCommits
  }

  public async mergeRepositoryBranches(meta: RepositoryMergeMeta) {
    const { owner, repo } = meta
    const repository = await this.octokit.rest.repos.get({ owner, repo })

    if (!repository) {
      throw new Error('Repository does not exist')
    }

    const { base, head } = meta
    const mergeResult = await this.octokit.rest.repos.merge({ owner, repo, base, head })
    return mergeResult.data
  }

  public async deleteBranch(meta: RemoveBranchMeta) {
    const { owner, repo } = meta
    const repository = await this.octokit.rest.repos.get({ owner, repo })

    if (!repository) {
      throw new Error('Repository does not exist')
    }

    const removeResult = await this.octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${meta.branch}`,
    })
    return removeResult.status
  }

  public async getCommitData(meta: RepositoryCommitMeta) {
    const { owner, repo, ref } = meta
    const repository = await this.octokit.rest.repos.get({ owner, repo })
    if (!repository) {
      throw new Error('Repository does not exist')
    }

    const commitDetails = await this.octokit.rest.repos.getCommit({ ref, repo, owner })
    const fileContentPromises = commitDetails.data.files?.map(async (file) => {
      const { data } = await this.octokit.rest.repos.getContent({
        repo,
        owner,
        ref,
        path: file.filename,
      })

      const response = await fetch((data as { download_url: string }).download_url)
      return response.text()
    })

    const fileContents = await Promise.all(fileContentPromises)
    commitDetails.data.files.forEach((file, index: number) => {
      Object.assign(file, { content: fileContents[index] })
    })

    return commitDetails.data
  }

  public async getRepositoryBranches(owner: string, repo: string) {
    let page = 1

    const allBranches = []
    let currentPageBranches = await this.octokit.rest.repos.listBranches({
      owner,
      repo,
      page,
      per_page: 50,
    })

    while (currentPageBranches.data.length) {
      page++
      allBranches.push(...currentPageBranches.data)
      currentPageBranches = await this.octokit.rest.repos.listBranches({
        owner,
        repo,
        page,
        per_page: 50,
      })
    }

    return allBranches
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
    let owner = repositoryIdentity.owner
    if (!owner) {
      const user = await this.octokit.rest.users.getAuthenticated()
      owner = user.data.login
    }

    // Step 0: Create repository if it does not exist
    const repository = await this.ensureRepoExists(owner, repo, isPrivate)

    // Step 1: Create branch if it does not exist
    await this.ensureBranchExists(owner, repo, ref, branchName)

    // Step 2: Get branch commit SHA
    const commitSHA = await this.getBranchHeadCommitSHA(owner, repo, branchName)

    // Step 3: Get current tree SHA
    const treeSHA = await this.getCommitTreeSHA(owner, repo, commitSHA)

    // Step 4: Prepare files for github
    const filesForGithub = await this.createFiles(owner, repo, files)

    // Step 5: Create new github tree
    const newTreeSHA = await this.createTree(owner, repo, filesForGithub, treeSHA)

    // Step 6: Create commit
    const newCommit = await this.octokit.rest.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      parents: [commitSHA],
      tree: newTreeSHA,
    })
    const newCommitSHA = newCommit.data.sha

    // Step 7: Update head
    await this.octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: newCommitSHA,
    })

    return `${GITHUB_REPOSITORY_BASE_URL}/${repository.full_name}`
  }

  private async ensureRepoExists(
    username: string,
    repo: string,
    isPrivate: boolean
  ): Promise<GithubRepositoryData> {
    const repositories = await this.getUserRepositories()
    const existingRepo = repositories.find(
      (repoMeta: GithubRepositoryData) => repoMeta.name === repo
    )
    if (existingRepo) {
      return existingRepo
    }

    return this.createRepository({ username, meta: { name: repo, private: isPrivate } })
  }

  private async ensureBranchExists(owner: string, repo: string, ref: string, branch: string) {
    const existingBranches = await this.getRepositoryBranches(owner, repo)
    const branchExists = existingBranches.some((branchMeta) => branchMeta.name === branch)

    if (!branchExists) {
      this.octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: ref,
      })
    }
  }

  private async getBranchHeadCommitSHA(
    owner: string,
    repo: string,
    branch: string
  ): Promise<string> {
    const { data } = await this.octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })
    return data.object.sha
  }

  private async getCommitTreeSHA(owner: string, repo: string, commitSHA: string): Promise<string> {
    const { data } = await this.octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: commitSHA,
    })

    return data.tree.sha
  }

  private async createFiles(
    owner: string,
    repo: string,
    files: GithubFile[]
  ): Promise<GithubFileMeta[]> {
    const promises = files.map((file) => {
      return this.createFile(owner, repo, file)
    })

    return Promise.all(promises)
  }

  private async createFile(owner: string, repo: string, file: GithubFile): Promise<GithubFileMeta> {
    const { data } =
      file.encoding === 'base64'
        ? await createBase64GithubFileBlob(file, repo, this.auth)
        : await this.octokit.rest.git.createBlob({ owner, repo, content: file.content })

    return {
      sha: file.status === 'deleted' ? null : data.sha,
      path: file.name,
      mode: '100644',
      type: 'blob',
    }
  }

  private async createTree(
    owner: string,
    repo: string,
    files: GithubFileMeta[],
    treeSHA?: string
  ): Promise<string> {
    const tree = await this.octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: treeSHA,
      // @ts-ignore
      tree: files,
    })
    return tree.data.sha
  }
}
