import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  GeneratedFile,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { GITHUB_API_BASE_URL } from './constants'

interface GithubFile {
  name: string
  path: string
  type: string
  url: string
  git_url: string
}

export const getGithubProjectAsFolder = async (
  owner: string,
  repo: string
): Promise<GeneratedFolder> => {
  const githubProjectFiles: GithubFile[] = await getRepoContent(owner, repo)

  const folder = createEmptyFolder(repo)
  return injectGithubFilesToFolder(githubProjectFiles, folder)
}

const getRepoContent = async (owner: string, repo: string): Promise<GithubFile[]> => {
  const contentUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/contents`
  return makeRequest(contentUrl)
}

const injectGithubFilesToFolder = async (
  githubFiles: GithubFile[],
  folder: GeneratedFolder
): Promise<GeneratedFolder> => {
  const { files, directories } = groupFilesByType(githubFiles)

  const filesContents = await getFilesContent(files)
  folder.files = folder.files.concat(filesContents)

  if (!directories || !directories.length) {
    return folder
  }

  for (const directory of directories) {
    const { url, name } = directory
    const directoryFiles = await makeRequest(url)
    const newFolder = createEmptyFolder(name)

    const folderWithFiles = await injectGithubFilesToFolder(directoryFiles, newFolder)
    folder.subFolders.push(folderWithFiles)
  }

  return folder
}

const createEmptyFolder = (name: string): GeneratedFolder => {
  return { files: [], subFolders: [], name }
}

const groupFilesByType = (files: GithubFile[]): Record<string, GithubFile[]> => {
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

const getFilesContent = async (githubFiles: GithubFile[]): Promise<GeneratedFile[]> => {
  const promises = githubFiles.map((fileData) => {
    return getGithubFileContent(fileData)
  })
  return Promise.all(promises)
}

const getGithubFileContent = async (githubFile: GithubFile): Promise<GeneratedFile> => {
  const { name, git_url } = githubFile
  const response = await makeRequest(git_url)
  const { content, encoding } = response

  return {
    content,
    name,
    contentEncoding: encoding || 'base64',
  }
}

const makeRequest = async (url: string, method: string = 'GET') => {
  const basicAuthToken = 'ionutpasca:31e75f99d12108a3f0522a20f42a6befbc3f2295'

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(basicAuthToken).toString('base64')}`,
    },
  })
  if (response.status === 403) {
    const message = await response.text()
    throw new Error(message)
  }
  return response.json()
}
