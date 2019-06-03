import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  GeneratedFile,
  GithubProjectMeta,
  TemplateProvider,
} from '@teleporthq/teleport-types'
import { GITHUB_API_BASE_URL } from '../constants'
import { NO_GITHUB_REPO, NO_GITHUB_OWNER } from '../errors'

interface GithubFile {
  name: string
  path: string
  type: string
  url: string
  git_url: string
}

export const createGithubProvider: TemplateProvider<GithubProjectMeta> = (
  githubMeta?: GithubProjectMeta
) => {
  const { owner, repo } = githubMeta
  let authHeader = generateGithubAuthHeader(githubMeta)

  const getTemplateAsFolder = async (meta?: GithubProjectMeta): Promise<GeneratedFolder> => {
    if (meta && meta.auth) {
      authHeader = generateGithubAuthHeader(meta)
    }

    const templateRepo = (meta && meta.repo) || repo
    if (!templateRepo) {
      throw new Error(NO_GITHUB_REPO)
    }

    const templateOwner = (meta && meta.owner) || owner
    if (!templateOwner) {
      throw new Error(NO_GITHUB_OWNER)
    }

    const githubProjectFiles: GithubFile[] = await getRepoContent(templateOwner, templateRepo)

    const folder = createEmptyFolder(repo)
    return injectGithubFilesToFolder(githubProjectFiles, folder)
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
      const directoryFiles = await makeGithubRequest(url)
      const newFolder = createEmptyFolder(name)

      const folderWithFiles = await injectGithubFilesToFolder(directoryFiles, newFolder)
      folder.subFolders.push(folderWithFiles)
    }

    return folder
  }

  const getRepoContent = async (
    templateOwner: string,
    repository: string
  ): Promise<GithubFile[]> => {
    const contentUrl = `${GITHUB_API_BASE_URL}/repos/${templateOwner}/${repository}/contents`
    return makeGithubRequest(contentUrl)
  }

  const getFilesContent = async (githubFiles: GithubFile[]): Promise<GeneratedFile[]> => {
    const promises = githubFiles.map((fileData) => {
      return getGithubFileContent(fileData)
    })
    return Promise.all(promises)
  }

  const getGithubFileContent = async (githubFile: GithubFile): Promise<GeneratedFile> => {
    const { name, git_url } = githubFile
    const response = await makeGithubRequest(git_url)
    const { content, encoding } = response

    return {
      content,
      name,
      contentEncoding: encoding || 'base64',
    }
  }

  const makeGithubRequest = async (url: string) => {
    // const basicAuthToken = 'ionutpasca:dc99af6fab43afe9e8b6d7d613ddb2297e0a8925'
    const headers = authHeader ? { Authorization: authHeader } : {}
    const method = 'GET'

    const response = await fetch(url, { method, headers })
    if (response.status === 403) {
      const message = await response.text()
      throw new Error(message)
    }
    return response.json()
  }

  return { getTemplateAsFolder }
}

const generateGithubAuthHeader = (metadata: GithubProjectMeta): string | null => {
  const { auth } = metadata
  if (!auth) {
    return null
  }

  if (auth.oauthToken) {
    return `token ${auth.oauthToken}`
  }

  if (!auth.basic) {
    return null
  }

  const basicAuthToken = `${auth.basic.username}:${auth.basic.accessToken}`
  return `Basic ${Buffer.from(basicAuthToken).toString('base64')}`
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
