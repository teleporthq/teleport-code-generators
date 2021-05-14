import path from 'path'
import chalk from 'chalk'
import { ensureDirSync, writeFileSync, readFileSync } from 'fs-extra'
import { GeneratedFile, GeneratedFolder } from '@teleporthq/teleport-types'
import { getPatchesBetweenFiles, mergeFiles } from './merge'
import { IGNORE_EXTENSIONS } from '../constants'

export const injectFilesFromSubFolder = (
  folder: GeneratedFolder[],
  targetPath: string,
  force = false
) => {
  folder.map((items) => {
    const { files, subFolders, name } = items
    ensureDirSync(path.join(process.cwd(), targetPath, name))
    injectFilesToPath(process.cwd(), path.join(targetPath, name), files, force)
    injectFilesFromSubFolder(subFolders, path.join(targetPath, name), force)
  })
}

export const injectFilesToPath = (
  rootFolder: string,
  targetPath: string,
  files: GeneratedFile[],
  force = false
): void => {
  try {
    ensureDirSync(path.join(rootFolder, targetPath))
    files.map((file) => {
      const fileName = `${file.name}.${file.fileType}`
      const filePath = path.join(rootFolder, targetPath, fileName)
      if (force) {
        writeFileSync(filePath, file.content, 'utf-8')
        return
      }

      /* If the file is not found in local, create it irrespective of
      file extension. */
      const localFile = findFileByName(path.join(targetPath, fileName))
      if (!localFile) {
        writeFileSync(filePath, file.content, 'utf-8')
        return
      }

      /* We re trying to merge .json type of files. Which are almost the same
      everytime we generate something from the UIDL. So, un-necessarly trying
      to merge these files creates un-expected conflicts */
      if (IGNORE_EXTENSIONS.includes(`.${file.fileType}`)) {
        return
      }

      const patches = getPatchesBetweenFiles(localFile, file.content)
      const fileContent = mergeFiles(patches)
      writeFileSync(filePath, fileContent, 'utf-8')
    })
  } catch (e) {
    console.warn(chalk.red(`Failed in writing file to destination`))
  }
}

export const findFileByName = (fileName: string) => {
  try {
    const file = readFileSync(path.join(process.cwd(), fileName))
    if (!file) {
      return null
    }
    return file.toString()
  } catch (e) {
    if (e.code === 'ENONET') {
      return null
    }
  }
}
