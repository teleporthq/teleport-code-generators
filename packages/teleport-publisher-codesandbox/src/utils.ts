import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'

export const convertToCodesandboxStructure = (
  folder: GeneratedFolder,
  prefix: string = ''
): Record<string, CodesandboxFile> => {
  const folderFiles: Record<string, CodesandboxFile> = folder.files.reduce((acc, file) => {
    const fileKey = prefix + file.name + (file.fileType ? `.${file.fileType}` : '')
    const fileValue = getCodeSandboxFile(file)
    acc[fileKey] = fileValue
    return acc
  }, {})

  const subFolderFiles = folder.subFolders.map((subFolder) =>
    convertToCodesandboxStructure(subFolder, `${prefix}${subFolder.name}/`)
  )
  const aggregatedFile = subFolderFiles.reduce((acc, file) => ({ ...acc, ...file }), {})

  return { ...folderFiles, ...aggregatedFile }
}

interface CodesandboxFile {
  content: string
  isBinary: boolean
}

const getCodeSandboxFile = (file: GeneratedFile): CodesandboxFile => {
  return {
    content: file.content,
    isBinary: !!(file.contentEncoding === 'base64'),
  }
}
