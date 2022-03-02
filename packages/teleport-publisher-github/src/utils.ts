import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'
import {
  createGithubGateway,
  GithubFile,
  RepositoryIdentity,
  GithubCommitMeta,
} from '@teleporthq/teleport-github-gateway'

import { GithubPublishMeta, ProjectFolderInfo } from './types'

export const generateProjectFiles = (folderInfo: ProjectFolderInfo): GithubFile[] => {
  const { folder, prefix = '', files = [], ignoreFolder = false } = folderInfo
  const folderToPutFileTo = ignoreFolder ? '' : `${prefix}${folder.name}/`

  folder.files.forEach((file: GeneratedFile) => {
    const fileName = file.fileType
      ? `${folderToPutFileTo}${file.name}.${file.fileType}`
      : `${folderToPutFileTo}${file.name}`

    const githubFile: GithubFile = {
      name: fileName,
      content: file.content,
      status: file.status,
    }

    if (file.contentEncoding) {
      githubFile.encoding = file.contentEncoding
    }

    files.push(githubFile)
  })

  folder.subFolders.forEach((subfolder: GeneratedFolder) => {
    const subfolderInfo = {
      files,
      folder: subfolder,
      prefix: folderToPutFileTo,
    }
    generateProjectFiles(subfolderInfo)
  })

  return files
}

export const publishToGithub = async (files: GithubFile[], meta: GithubPublishMeta) => {
  const {
    authMeta,
    mainBranch,
    commitBranch,
    commitMessage,
    repository,
    repositoryOwner,
    isPrivate,
  } = meta

  const repositoryIdentity: RepositoryIdentity = {
    owner: repositoryOwner,
    repo: repository,
    ref: mainBranch,
  }

  const gitCommitMeta: GithubCommitMeta = {
    repositoryIdentity,
    files,
    branchName: commitBranch,
    commitMessage,
    isPrivate,
  }

  const githubGateway = createGithubGateway(authMeta)
  return githubGateway.commitFilesToRepo(gitCommitMeta)
}
