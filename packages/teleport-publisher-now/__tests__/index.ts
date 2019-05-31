import { createNowPublisher } from '../src'

import project from './project-files.json'
import { NO_PROJECT_UIDL, NO_DEPLOY_TOKEN } from '../lib/errors'

const token = 'deploy-token'

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
    publisher.setDeployToken(token)

    const publisherDeployToken = publisher.getDeployToken()
    expect(publisherDeployToken).toBe(token)
  })

  it('should fail if no project is provided', async () => {
    const publisher = createNowPublisher()
    publisher.setDeployToken(token)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PROJECT_UIDL)
  })

  it('should fail if not deploy token is provided', async () => {
    const publisher = createNowPublisher()
    publisher.setProject(project)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_DEPLOY_TOKEN)
  })

  it('should fail if deploy token is provided', async () => {
    const publisher = createNowPublisher()

    const { success, payload } = await publisher.publish({ project, deployToken: token })
    expect(success).toBeFalsy()
    expect(payload).toBe('Not authorized')
  })
})
