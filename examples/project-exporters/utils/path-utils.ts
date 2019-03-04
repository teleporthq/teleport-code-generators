import * as fs from 'fs'
import path from 'path'
import rimraf from 'rimraf'

import { GeneratorTypes } from '../../../src'

interface FileInfo {
  filename: string
  dirPath: string
}
export const listDir = (dirPath: string): Promise<FileInfo[]> =>
  new Promise((resolve, reject) => {
    fs.readdir(dirPath, async (err, files) => {
      if (err) {
        reject(err)
      }
      resolve(
        files.map((file) => ({
          dirPath,
          filename: file,
        }))
      )
    })
  })

export const lstat = (filePath: string): Promise<any> =>
  new Promise((resolve, reject) => {
    fs.lstat(filePath, (err, stats) => {
      if (err) {
        reject(err)
      }
      resolve(stats)
    })
  })

export const copyFile = async (inputPath: string, outputPath: string) => {
  const rd = fs.createReadStream(inputPath)
  const wr = fs.createWriteStream(outputPath)
  try {
    return await new Promise((resolve, reject) => {
      rd.on('error', reject)
      wr.on('error', reject)
      wr.on('finish', resolve)
      rd.pipe(wr)
    })
  } catch (error) {
    rd.destroy()
    wr.end()
    throw error
  }
}

export const copyDirRec = async (sourcePath: string, targetPath: string) => {
  const filesToCopy = await listDir(sourcePath)
  await mkdir(targetPath)
  while (filesToCopy.length) {
    const fileOrDir = filesToCopy.pop() as FileInfo
    const stats = await lstat(`${fileOrDir.dirPath}/${fileOrDir.filename}`)
    if (stats.isDirectory()) {
      const newFiles = await listDir(`${fileOrDir.dirPath}/${fileOrDir.filename}`)
      filesToCopy.push(...newFiles)

      await mkdir(`${targetPath}${fileOrDir.dirPath.replace(sourcePath, '')}/${fileOrDir.filename}`)
    } else {
      fs.copyFileSync(
        `${fileOrDir.dirPath}/${fileOrDir.filename}`,
        `${targetPath}/${fileOrDir.dirPath.replace(sourcePath, '')}/${fileOrDir.filename}`
      )
    }
  }

  listDir(sourcePath)
}

export const removeDir = (pathToRemove: string) =>
  new Promise((resolve, reject) => {
    rimraf(pathToRemove, (err: any) => {
      if (err) {
        reject(err)
      }

      resolve()
    })
  })

export const writeTextFile = (pathToFile: string, fileName: string, fileContent: string) => {
  const filePath = path.join(pathToFile, fileName)
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, fileContent, 'utf8', (err) => {
      if (err) {
        reject(err)
      }

      resolve()
    })
  })
}

export const mkdir = (pathToDir: string) =>
  new Promise((resolve, reject) => {
    fs.mkdir(pathToDir, (err) => {
      if (err) {
        reject(err)
      }
      resolve()
    })
  })

export const readFile = (pathToFile: string, encoding = 'utf8'): Promise<string> =>
  new Promise((resolve, reject) => {
    fs.readFile(pathToFile, encoding, (err, file) => {
      if (err) {
        reject(err)
      }
      resolve(file)
    })
  })

export const readJSON = async (pathToFile: string) => {
  const file = await readFile(pathToFile)
  try {
    const jsonFile = JSON.parse(file)
    return jsonFile
  } catch (err) {
    return null
  }
}

export const writeFolder = async (folder: GeneratorTypes.Folder, currentPath: string) => {
  const { name, files, subFolders } = folder

  const folderPath = path.join(currentPath, name)

  if (!fs.existsSync(folderPath)) {
    await mkdir(folderPath)
    console.info('Created folder: ', folderPath)
  }

  for (const file of files) {
    const fileName = file.name + file.extension
    await writeTextFile(folderPath, fileName, file.content)
    console.info('Created file: ', path.join(folderPath, fileName))
  }

  subFolders.forEach((child) => writeFolder(child, folderPath))
}

export const tsEnumToArray = (enumeration: any) =>
  Object.keys(enumeration).filter((v) => isNaN(Number(v)))
