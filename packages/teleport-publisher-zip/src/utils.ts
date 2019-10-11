import JSZip from 'jszip'
import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'

export const isNodeProcess = (): boolean => {
  return (
    typeof process === 'object' &&
    typeof process.versions === 'object' &&
    typeof process.versions.node !== 'undefined'
  )
}

export const writeZipToDisk = (
  zipFolderPath: string,
  content: Buffer | Blob,
  zipName: string
): void => {
  const fs = require('fs')
  const path = require('path')

  if (!fs.existsSync(zipFolderPath)) {
    fs.mkdirSync(zipFolderPath, { recursive: true })
  }

  const zipPath = path.join(zipFolderPath, `${zipName}.zip`)

  const writeStream = fs.createWriteStream(zipPath)
  writeStream.write(content)
  writeStream.end()
}

export const generateProjectZip = async (project: GeneratedFolder): Promise<Buffer | Blob> => {
  let zip = new JSZip()
  zip = writeFolderToZip(project, zip, true)
  const zipType = isNodeProcess() ? 'nodebuffer' : 'blob'
  return zip.generateAsync({ type: zipType })
}

const writeFolderToZip = (
  folder: GeneratedFolder,
  parentFolder: JSZip,
  ignoreFolder: boolean = false
) => {
  const zipFolder = ignoreFolder ? parentFolder : parentFolder.folder(folder.name)

  folder.files.forEach((file: GeneratedFile) => {
    const options = file.contentEncoding === 'base64' ? { base64: true } : {}
    const fileName = file.fileType ? `${file.name}.${file.fileType}` : file.name
    zipFolder.file(fileName, file.content, options)
  })

  folder.subFolders.forEach((subFolder: GeneratedFolder) => {
    writeFolderToZip(subFolder, zipFolder)
  })

  return parentFolder
}
