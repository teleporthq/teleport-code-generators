import createDiskPublisher from '../src'

import project from './project-files.json'
import { join } from 'path'
import { existsSync, readdirSync, unlinkSync, rmdirSync, statSync } from 'fs'

const projectPath = join(__dirname, 'disk-project')

afterAll(() => {
  removeDirectory(projectPath)
})

describe('teleport publisher disk', () => {
  it('creates a new instance of disk publisher', () => {
    const publisher = createDiskPublisher()
    expect(publisher.getOutputPath).toBeDefined()
    expect(publisher.setOutputPath).toBeDefined()
    expect(publisher.getProject).toBeDefined()
    expect(publisher.setProject).toBeDefined()
    expect(publisher.publish).toBeDefined()
  })

  it('should set project', () => {
    const publisher = createDiskPublisher()
    publisher.setProject(project)

    const publisherProject = JSON.stringify(publisher.getProject())
    expect(publisherProject).toBe(JSON.stringify(project))
  })

  it('should set output path', () => {
    const publisher = createDiskPublisher()
    publisher.setOutputPath(projectPath)

    const publisherPath = publisher.getOutputPath()
    expect(publisherPath).toBe(projectPath)
  })

  it('should publish project', async () => {
    const publisher = createDiskPublisher()

    publisher.setOutputPath(projectPath)
    publisher.setProject(project)

    await publisher.publish()

    const projectFolderExists = existsSync(projectPath)
    expect(projectFolderExists).toBe(true)
    // Need to add some more checks
  })
})

const removeDirectory = (dirPath: string): void => {
  if (!existsSync(dirPath)) {
    return
  }

  const files = readdirSync(dirPath)

  for (const file of files) {
    const filePath = join(dirPath, file)
    statSync(filePath).isFile() ? unlinkSync(filePath) : removeDirectory(filePath)
  }

  rmdirSync(dirPath)
}
