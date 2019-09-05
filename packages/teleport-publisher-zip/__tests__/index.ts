import { join } from 'path'
import { existsSync, readdirSync, unlinkSync, rmdirSync, statSync } from 'fs'
import JSZip from 'jszip'

import { createZipPublisher } from '../src'

import { NO_PROJECT_UIDL } from '../src/errors'

// @ts-ignore
import project from './project-files.json'

const projectPath = join(__dirname, 'disk-project')

afterAll(() => {
  removeDirectory(projectPath)
})

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

  it('should fail if no project is provided', async () => {
    const publisher = createZipPublisher()

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PROJECT_UIDL)
  })

  it('should generate project', async () => {
    const publisher = createZipPublisher({ outputPath: projectPath })

    const { success } = await publisher.publish({ project })
    expect(success).toBeTruthy()
  })

  it('should generate project and write the zip to disk if output is provided', async () => {
    const publisher = createZipPublisher({ project, outputPath: projectPath })
    const zipName = 'zip-name'

    const { success, payload } = await publisher.publish({ projectName: zipName })
    expect(success).toBeTruthy()

    const zipPath = join(projectPath, `${zipName}.zip`)
    const zipFileExists = existsSync(zipPath)
    expect(zipFileExists).toBeTruthy()

    const zipInstance = new JSZip()
    const zipContent = await zipInstance.loadAsync(payload, {
      createFolders: true,
    })

    const packageJsonFile = zipContent.files['package.json']
    expect(packageJsonFile.name).toBe('package.json')
    expect(packageJsonFile.dir).toBeFalsy()

    const pagesFolder = zipContent.files['pages/']
    expect(pagesFolder.dir).toBeTruthy()

    const indexFile = zipContent.files['pages/index.js']
    expect(indexFile.name).toBe('pages/index.js')
    expect(indexFile.dir).toBeFalsy()

    const componentsFolder = zipContent.files['components/']
    expect(componentsFolder.dir).toBeTruthy()
  })
})

it('should generate project and write the zip to disk having the project name as follback for zip name', async () => {
  const publisher = createZipPublisher({ project, outputPath: projectPath })

  const { success } = await publisher.publish()
  expect(success).toBeTruthy()

  const zipPath = join(projectPath, `${project.name}.zip`)
  const zipFileExists = existsSync(zipPath)
  expect(zipFileExists).toBeTruthy()
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
