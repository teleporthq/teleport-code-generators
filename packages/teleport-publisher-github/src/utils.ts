import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'
import {
  GithubFile,
  RepositoryIdentity,
  GithubCommitMeta,
} from '@teleporthq/teleport-github-gateway/dist/cjs/types'
import { createGithubGateway } from '@teleporthq/teleport-github-gateway'

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
  const { authMeta, masterBranch, commitBranch, commitMessage, repository, repositoryOwner } = meta

  const repositoryIdentity: RepositoryIdentity = {
    username: repositoryOwner,
    repo: repository,
    ref: masterBranch,
  }

  const gitCommitMeta: GithubCommitMeta = {
    repositoryIdentity,
    files,
    branchName: commitBranch,
    commitMessage,
  }

  const githubGateway = createGithubGateway(authMeta)
  return githubGateway.commitFilesToRepo(gitCommitMeta)
}
