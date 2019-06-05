import { createGithubGateway } from '../src'
import GithubInstance from '../src/github-instance'

describe('teleport github gateway', () => {
  it('creates a new instance of gateway', () => {
    const gateway = createGithubGateway()
    expect(gateway.getRepository).toBeDefined()
    expect(gateway.getUserRepositories).toBeDefined()
    expect(gateway.createRepository).toBeDefined()
    expect(gateway.commitFilesToRepo).toBeDefined()
  })

  it('creates a new github instance', () => {
    const githubInstance = new GithubInstance()
    expect(githubInstance.authorize).toBeDefined()
    expect(githubInstance.commitFilesToRepo).toBeDefined()
    expect(githubInstance.createRepository).toBeDefined()
    expect(githubInstance.getUserRepositories).toBeDefined()
    expect(githubInstance.getRepoContent).toBeDefined()
  })
})
