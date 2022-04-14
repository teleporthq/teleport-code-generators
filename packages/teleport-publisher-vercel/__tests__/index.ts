import { createVercelPublisher } from '../src'
import { projectFiles } from './mocks'
const token = 'deploy-token'

describe('teleport publisher vercel', () => {
  it('creates a new instance of vercel publisher', () => {
    const publisher = createVercelPublisher()
    expect(publisher.getAccessToken).toBeDefined()
    expect(publisher.setAccessToken).toBeDefined()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createVercelPublisher()
    publisher.setProject(projectFiles)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(projectFiles))
  })

  it.skip('should deploy project', async () => {
    jest.setTimeout(80000)
    const publisher = createVercelPublisher()
    const publishedProject = await publisher.publish({
      projectSlug: 'aaa',
      project: projectFiles,
      framework: 'nextjs',
      individualUpload: true,
      accessToken: token,
    })
    expect(publishedProject.success).toBeTruthy()
  })

  it('should set deploy token', () => {
    const publisher = createVercelPublisher()
    publisher.setAccessToken(token)

    const publisherDeployToken = publisher.getAccessToken()
    expect(publisherDeployToken).toBe(token)
  })

  it('should fail if no project is provided', async () => {
    const publisher = createVercelPublisher()
    publisher.setAccessToken(token)

    await expect(publisher.publish()).rejects.toThrow(Error)
  })
})
