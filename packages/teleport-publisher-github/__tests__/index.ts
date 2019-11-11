import { createGithubPublisher } from '../src'

import { NO_PROJECT_UIDL, NO_AUTH, NO_REPO } from '../src/errors'

import project from './project-files.json'
import githubFiles from './github-files-content.json'
import { generateProjectFiles } from '../src/utils'

describe('teleport publisher github', () => {
  it('creates a new instance of github publisher', () => {
    const publisher = createGithubPublisher()
    expect(publisher.getCommitMessage).toBeDefined()
    expect(publisher.getMasterBranchName).toBeDefined()
    expect(publisher.getCommitBranchName).toBeDefined()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.getRepository).toBeDefined()
    expect(publisher.getRepositoryOwner).toBeDefined()

    expect(publisher.setCommitMessage).toBeDefined()
    expect(publisher.setMasterBranchName).toBeDefined()
    expect(publisher.setCommitBranchName).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.setRepository).toBeDefined()
    expect(publisher.setRepositoryOwner).toBeDefined()

    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createGithubPublisher()
    publisher.setProject(project)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(project))
  })

  it('should set commit message', () => {
    const MESSAGE = 'test message'
    const publisher = createGithubPublisher()
    publisher.setCommitMessage(MESSAGE)

    const publisherCommitMessage = JSON.stringify(publisher.getCommitMessage())
    expect(publisherCommitMessage).toBe(JSON.stringify(MESSAGE))
  })

  it('should set master branch name', () => {
    const BRANCH = 'master'
    const publisher = createGithubPublisher()
    publisher.setMasterBranchName(BRANCH)

    const publisherMasterBranch = JSON.stringify(publisher.getMasterBranchName())
    expect(publisherMasterBranch).toBe(JSON.stringify(BRANCH))
  })

  it('should set commit branch name', () => {
    const BRANCH = 'commit-branch'
    const publisher = createGithubPublisher()
    publisher.setCommitBranchName(BRANCH)

    const publisherCommitBranch = JSON.stringify(publisher.getCommitBranchName())
    expect(publisherCommitBranch).toBe(JSON.stringify(BRANCH))
  })

  it('should set repository name', () => {
    const REPOSITORY = 'test-repo'
    const publisher = createGithubPublisher()
    publisher.setRepository(REPOSITORY)

    const publisherRepository = JSON.stringify(publisher.getRepository())
    expect(publisherRepository).toBe(JSON.stringify(REPOSITORY))
  })

  it('should set repository owner', () => {
    const OWNER = 'test-owner'
    const publisher = createGithubPublisher()
    publisher.setRepositoryOwner(OWNER)

    const publisherOwner = JSON.stringify(publisher.getRepositoryOwner())
    expect(publisherOwner).toBe(JSON.stringify(OWNER))
  })

  it('should fail if no project is provided', async () => {
    const publisher = createGithubPublisher()

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PROJECT_UIDL)
  })

  it('should fail if no auth data is provided', async () => {
    const publisher = createGithubPublisher()
    publisher.setProject(project)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_AUTH)
  })

  it('should fail if no repository is provided', async () => {
    const publisher = createGithubPublisher({
      authMeta: { basic: { username: 'test', password: 'test' } },
    })
    publisher.setProject(project)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_REPO)
  })

  it('should generate github project files from generated folder', () => {
    const files = generateProjectFiles({ folder: project, ignoreFolder: true })
    expect(JSON.stringify(files)).toBe(JSON.stringify(githubFiles))
  })
})
