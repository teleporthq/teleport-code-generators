import createZipPublisher from '../src'

import project from './project-files.json'

describe('teleport publisher zip', () => {
  it('creates a new instance of zip publisher', () => {
    const publisher = createZipPublisher()
    expect(publisher.getOutputPath).toBeDefined()
    expect(publisher.setOutputPath).toBeDefined()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createZipPublisher()
    publisher.setProject(project)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(project))
  })

  it('should set output path', () => {
    const publisher = createZipPublisher()
    const path = 'test-path'
    publisher.setOutputPath(path)

    const publisherPath = publisher.getOutputPath()
    expect(publisherPath).toBe(path)
  })

  // Need to add at least a test for the publish method
})
