import Github from 'github-api'

import { GithubAuthMeta } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

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
} from './types'
import { createBase64GithubFileBlob } from './utils'

export default class GithubInstance {
  private githubApi = null
  private auth: GithubAuthMeta = null

  constructor(auth: GithubAuthMeta = {}) {
    this.authorize(auth)
  }

  public authorize(auth: GithubAuthMeta = {}) {
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

  public async getUserRepositories(username: string): Promise<GithubRepositoryData[]> {
    const user = await this.githubApi.getUser(username)
    const { data } = await user.listRepos()
    return data
  }

  public async createRepository(repository: NewRepository): Promise<GithubRepositoryData> {
    const { username, meta } = repository
    const user = await this.githubApi.getUser(username)

    // Auto initialize repository by creating an initial commit with empty README
    if (typeof meta.auto_init === 'undefined' || meta.auto_init === null) {
      meta.auto_init = true
    }

    const { data } = await user.createRepo(meta)
    return data
  }

  public async commitFilesToRepo(commitMeta: GithubCommitMeta): Promise<string> {
    const {
      branchName,
      files,
      repositoryIdentity,
      commitMessage = DEFAULT_COMMIT_MESSAGE,
    } = commitMeta
    const { username, repo, ref = DEFAULT_REF } = repositoryIdentity

    // Step 0: Create repository if it does not exist
    await this.ensureRepoExists(username, repo)
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

  private async ensureRepoExists(username: string, repo: string): Promise<void> {
    const repositories = await this.getUserRepositories(username)
    const repoExists = repositories.some((repoMeta: GithubRepositoryData) => repoMeta.name === repo)

    if (!repoExists) {
      await this.createRepository({ username, meta: { name: repo } })
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
      sha: data.sha,
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
