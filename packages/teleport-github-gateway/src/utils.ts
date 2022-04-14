import { GeneratedFolder, GeneratedFile, FileEncoding } from '@teleporthq/teleport-types'
import { GithubFile, FilesFetcherMeta } from './types'

import { DEFAULT_REF, FILE_EXTENTIONS_TO_DECODE } from './constants'

export const createEmptyFolder = (name: string): GeneratedFolder => {
  return { files: [], subFolders: [], name }
}

export const fetchFilesContent = async (
  githubFiles: GithubFile[],
  folder: GeneratedFolder,
  meta: FilesFetcherMeta
): Promise<GeneratedFolder> => {
  const { githubInstance, userRepositoryIdentity } = meta
  const { files, directories } = groupGithubFilesByType(githubFiles)

  const filesContents = await getFilesContent(files, meta)
  folder.files = folder.files.concat(filesContents)

  if (!directories || !directories.length) {
    return folder
  }

  for (const directory of directories) {
    const { name, path } = directory

    const directoryFilesParams = { ...userRepositoryIdentity, path }
    const data = await githubInstance.getRepoContent(directoryFilesParams)

    const newFolder = createEmptyFolder(name)
    const folderWithFiles = await fetchFilesContent(data as GithubFile[], newFolder, meta)

    folder.subFolders.push(folderWithFiles)
  }

  return folder
}

const groupGithubFilesByType = (files: GithubFile[]): Record<string, GithubFile[]> => {
  return files.reduce(
    (acc: { files: GithubFile[]; directories: GithubFile[] }, file) => {
      if (file.type === 'file') {
        acc.files.push(file)
      }
      if (file.type === 'dir') {
        acc.directories.push(file)
      }
      return acc
    },
    { files: [], directories: [] }
  )
}

const getFilesContent = async (
  files: GithubFile[],
  meta: FilesFetcherMeta
): Promise<GeneratedFile[]> => {
  const promises = files.map((file) => {
    return getFileContent(file, meta)
  })

  return Promise.all(promises)
}

const getFileContent = async (
  githubFile: GithubFile,
  meta: FilesFetcherMeta
): Promise<GeneratedFile> => {
  const { path, name } = githubFile

  const { githubInstance, userRepositoryIdentity } = meta
  const { ref = DEFAULT_REF } = userRepositoryIdentity

  const githubFileMetadata = { ...userRepositoryIdentity, ref, path }
  const data = await githubInstance.getRepoContent(githubFileMetadata)

  let { content, encoding } = data as GithubFile

  const splittedName = name.split('.')
  const fileType = splittedName.pop()
  const fileName = splittedName.join('.')

  if (fileMustBeDecoded(fileType, encoding)) {
    content = decodeBase64Content(content)
    encoding = 'utf8'
  }

  return {
    content,
    fileType,
    name: fileName,
    contentEncoding: encoding,
  }
}

const fileMustBeDecoded = (fileType: string, encoding: FileEncoding): boolean => {
  return encoding === 'base64' && FILE_EXTENTIONS_TO_DECODE.indexOf(fileType) !== -1
}

const decodeBase64Content = (base64Content: string): string => {
  return new Buffer(base64Content, 'base64').toString()
}
