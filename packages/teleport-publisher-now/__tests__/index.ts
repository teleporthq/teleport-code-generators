import createNowPublisher from '../src'

import project from './project-files.json'

describe('teleport publisher now', () => {
  it('creates a new instance of now publisher', () => {
    const publisher = createNowPublisher()
    expect(publisher.getDeployToken).toBeDefined()
    expect(publisher.setDeployToken).toBeDefined()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createNowPublisher()
    publisher.setProject(project)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(project))
  })

  it('should set deploy token', () => {
    const publisher = createNowPublisher()
    const token = 'deploy-token'
    publisher.setDeployToken(token)

    const publisherDeployToken = publisher.getDeployToken()
    expect(publisherDeployToken).toBe(token)
  })
})
