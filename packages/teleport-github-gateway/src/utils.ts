import fetch from 'cross-fetch'
import { GeneratedFolder, GeneratedFile, ServiceAuth } from '@teleporthq/teleport-types'
import { GithubFile, FilesFetcherMeta, GithubCreateResponse } from './types'

import { DEFAULT_REF, GITHUB_API_BASE_URL } from './constants'

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
    const { data } = await githubInstance.getRepoContent(directoryFilesParams)

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
  const { data } = await githubInstance.getRepoContent(githubFileMetadata)
  const { content, encoding } = data as GithubFile

  return {
    content,
    name,
    contentEncoding: encoding || 'base64',
  }
}

// We need with method in order to commit base64 encoded files (assets) to github
// The library we are using (github-api) does not currently support binary files commits
export const createBase64GithubFileBlob = async (
  file: GeneratedFile,
  repository: string,
  auth?: ServiceAuth
): Promise<GithubCreateResponse> => {
  const url = `${GITHUB_API_BASE_URL}/repos/${repository}/git/blobs`

  const authHeader = createAuthHeader(auth)
  const payload = JSON.stringify({ content: file.content, encoding: 'base64' })

  const response = await makeRequest(url, payload, authHeader)

  const data = await response.json()
  return { data }
}

const createAuthHeader = (auth?: ServiceAuth): string => {
  if (!auth) {
    return null
  }

  if (auth.token) {
    return `token ${auth.token}`
  }

  if (!auth.basic) {
    return null
  }

  const basicAuthToken = `${auth.basic.username}:${auth.basic.password}`
  return `Basic ${Buffer.from(basicAuthToken).toString('base64')}`
}

const makeRequest = (url: string, body: string, authHeader: string, method: string = 'POST') => {
  return fetch(url, {
    method,
    body,
    headers: { Authorization: authHeader },
  })
}
