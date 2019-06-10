import { createNowPublisher } from '../src'

import { NO_PROJECT_UIDL, NO_ACCESS_TOKEN } from '../lib/errors'

// @ts-ignore
import project from './project-files.json'

const token = 'deploy-token'

describe('teleport publisher now', () => {
  it('creates a new instance of now publisher', () => {
    const publisher = createNowPublisher()
    expect(publisher.getAccessToken).toBeDefined()
    expect(publisher.setAccessToken).toBeDefined()
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
    publisher.setAccessToken(token)

    const publisherDeployToken = publisher.getAccessToken()
    expect(publisherDeployToken).toBe(token)
  })

  it('should fail if no project is provided', async () => {
    const publisher = createNowPublisher()
    publisher.setAccessToken(token)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PROJECT_UIDL)
  })

  it('should fail if not deploy token is provided', async () => {
    const publisher = createNowPublisher()
    publisher.setProject(project)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_ACCESS_TOKEN)
  })

  it('should fail if deploy token is provided', async () => {
    const publisher = createNowPublisher()

    const { success, payload } = await publisher.publish({ project, accessToken: token })
    expect(success).toBeFalsy()
    expect(payload).toBe('Not authorized')
  })
})
