import createNetlifyPublisher from '../src'

import project from './project-files.json'

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
    const token = 'access-token'
    publisher.setAccessToken(token)

    const publisherAccessToken = publisher.getAccessToken()
    expect(publisherAccessToken).toBe(token)
  })
})
