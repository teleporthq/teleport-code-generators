import createNetlifyPublisher from '../src'

import project from './project-files.json'
import { NO_PROJECT_UIDL, NO_ACCESS_TOKEN } from '../src/errors'

const token = 'access-token'

describe('teleport publisher netlify', () => {
  it('creates a new instance of netlify publisher', () => {
    const publisher = createNetlifyPublisher()
    expect(publisher.getAccessToken).toBeDefined()
    expect(publisher.setAccessToken).toBeDefined()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createNetlifyPublisher()
    publisher.setProject(project)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(project))
  })

  it('should set access token', () => {
    const publisher = createNetlifyPublisher()
    publisher.setAccessToken(token)

    const publisherAccessToken = publisher.getAccessToken()
    expect(publisherAccessToken).toBe(token)
  })

  it('should fail if no project is provided', async () => {
    const publisher = createNetlifyPublisher()
    publisher.setAccessToken(token)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PROJECT_UIDL)
  })

  it('should fail if not access token is provided', async () => {
    const publisher = createNetlifyPublisher()
    publisher.setProject(project)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_ACCESS_TOKEN)
  })

  it('should fail if invalid access token is provided', async () => {
    const publisher = createNetlifyPublisher()
    const { success, payload } = await publisher.publish({ project, accessToken: token })
    expect(success).toBeFalsy()
    expect(payload).toBe('Unauthorized')
  })
})
