import { existsSync, mkdir, writeFile, WriteFileOptions } from 'fs'
import PathResolver from 'path-browserify'
import fetch from 'cross-fetch'
const { join } = PathResolver
import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'

export const writeFolder = async (
  folder: GeneratedFolder,
  currentPath: string,
  createProjectFolder = true
): Promise<void> => {
  const { name, files, subFolders } = folder

  const folderPath = createProjectFolder ? join(currentPath, name) : currentPath

  if (!existsSync(folderPath)) {
    await createDirectory(folderPath)
  }

  const promises = [
    writeFilesToFolder(folderPath, files),
    writeSubFoldersToFolder(folderPath, subFolders),
  ]

  await Promise.all(promises)
}

const writeFilesToFolder = async (folderPath: string, files: GeneratedFile[]): Promise<void> => {
  const promises = []
  for (const file of files) {
    const fileName = file.fileType ? `${file.name}.${file.fileType}` : file.name
    const filePath = join(folderPath, fileName)

    if (file.location === 'remote' && !file?.contentEncoding && !file.fileType) {
      const response = await fetch(file.content)
      const arrayBuffer = await response.arrayBuffer()
      promises.push(writeContentToFile(filePath, Buffer.from(arrayBuffer)))
      continue
    }

    promises.push(writeContentToFile(filePath, file.content, file.contentEncoding))
  }
  await Promise.all(promises)
}

const writeSubFoldersToFolder = async (
  folderPath: string,
  subFolders: GeneratedFolder[]
): Promise<void> => {
  const promises = subFolders.map((subFolder) => {
    return writeFolder(subFolder, folderPath)
  })

  await Promise.all(promises)
}

const createDirectory = (pathToDir: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    mkdir(pathToDir, { recursive: true }, (err) => {
      err ? reject(err) : resolve()
    })
  })
}

const writeContentToFile = (
  filePath: string,
  fileContent: string | Buffer,
  encoding: WriteFileOptions = 'utf8'
): Promise<void> => {
  return new Promise((resolve, reject) => {
    writeFile(filePath, fileContent, encoding, (err) => {
      err ? reject(err) : resolve()
    })
  })
}
