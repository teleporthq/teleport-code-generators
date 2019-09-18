import { createCodesandboxPublisher } from '../src'
import { createProjectFolder } from './mocks'

describe('codesandbox publisher', () => {
  it('creates a new instance of the publisher', () => {
    const publisher = createCodesandboxPublisher()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createCodesandboxPublisher()
    const project = createProjectFolder()
    publisher.setProject(project)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(project))
  })
})
