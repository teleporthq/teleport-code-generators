import { join } from 'path'
import {
  existsSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  statSync,
  readFile,
  chmodSync,
  mkdir,
  constants,
} from 'fs'

import { createDiskPublisher } from '../src'

import project from './project-files.json'
import { NO_PROJECT_UIDL } from '../src/errors'

const projectPath = join(__dirname, 'disk-project')
const noPermissionsPath = join(__dirname, 'no-permissions-folder')

afterAll(() => {
  removeDirectory(projectPath)
  removeDirectory(noPermissionsPath)
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

  it('should fail if no project is provided', async () => {
    const publisher = createDiskPublisher()
    publisher.setOutputPath(projectPath)

    const { success, payload } = await publisher.publish()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PROJECT_UIDL)
  })

  // it('should fail if there are no writing permissions to the output folder', async () => {
  //   const publisher = createDiskPublisher({ project, outputPath: noPermissionsPath })
  //   await createFolderWithNoWritePermissions(noPermissionsPath)

  //   const { success, payload } = await publisher.publish()
  //   expect(success).toBeFalsy()

  //   const indexOfAccessError = JSON.stringify(payload).indexOf('EACCES')
  //   expect(indexOfAccessError).toBeGreaterThan(-1)
  // })

  it('should publish project', async () => {
    const publisher = createDiskPublisher()

    const { success } = await publisher.publish({ project, outputPath: projectPath })
    expect(success).toBeTruthy()

    const projectFolderExists = existsSync(projectPath)
    expect(projectFolderExists).toBe(true)

    const firstPage = project.subFolders[0].files[0]
    const pagePath = join(
      projectPath,
      project.name,
      project.subFolders[0].name,
      `${firstPage.name}.${firstPage.fileType}`
    )

    const firstComponent = project.subFolders[1].files[0]
    const componentPath = join(
      projectPath,
      project.name,
      project.subFolders[1].name,
      `${firstComponent.name}.${firstComponent.fileType}`
    )

    const packageJson = project.files[0]
    const packageJsonPath = join(
      projectPath,
      project.name,
      `${packageJson.name}.${packageJson.fileType}`
    )

    const pageContent = await getFileContent(pagePath)
    expect(pageContent).toBe(firstPage.content)

    const componentContent = await getFileContent(componentPath)
    expect(componentContent).toBe(firstComponent.content)

    const packageJsonContent = await getFileContent(packageJsonPath)
    expect(packageJsonContent).toBe(packageJson.content)
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

// const createFolderWithNoWritePermissions = (path: string): Promise<void> => {
//   return new Promise((resolve, reject) => {
//     mkdir(path, { recursive: true }, (error) => {
//       if (error) {
//         return reject(error)
//       }
//       const readByUserOnly = constants.S_IRUSR
//       chmodSync(path, readByUserOnly)
//       resolve()
//     })
//   })
// }

const getFileContent = (path: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    readFile(path, 'utf8', (error, content) => {
      error ? reject(error) : resolve(content)
    })
  })
}
