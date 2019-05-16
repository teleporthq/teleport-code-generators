import { existsSync, mkdir, writeFile } from 'fs'
import { join } from 'path'

import {
  GeneratedFolder,
  GeneratedFile,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

export const writeFolder = async (folder: GeneratedFolder, currentPath: string) => {
  const { name, files, subFolders } = folder

  const folderPath = join(currentPath, name)

  if (!existsSync(folderPath)) {
    await createDirectory(folderPath)
  }

  const promises = [
    writeFilesToFolder(folderPath, files),
    writeSubFoldersToFolder(folderPath, subFolders),
  ]

  return Promise.all(promises)
}

const writeFilesToFolder = async (folderPath: string, files: GeneratedFile[]): Promise<void> => {
  for (const file of files) {
    const fileName = `${file.name}.${file.fileType}`
    const filePath = join(folderPath, fileName)
    await writeContentToFile(filePath, file.content, file.contentEncoding)
  }
}

const writeSubFoldersToFolder = async (
  folderPath: string,
  subFolders: GeneratedFolder[]
): Promise<void> => {
  for (const subfolder of subFolders) {
    await writeFolder(subfolder, folderPath)
  }
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
  fileContent: string,
  encoding: string = 'utf8'
): Promise<void> => {
  return new Promise((resolve, reject) => {
    writeFile(filePath, fileContent, encoding, (err) => {
      err ? reject(err) : resolve()
    })
  })
}
