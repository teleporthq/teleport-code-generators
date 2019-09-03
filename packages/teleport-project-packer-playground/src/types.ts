import { ServiceAuth, AssetInfo } from '@teleporthq/teleport-types'

interface PublisherOptions {
  accessToken?: string
  projectName?: string
  outputPath?: string
  createProjectFolder?: boolean // used only by the disk publisher
}

interface GithubOptions {
  authMeta?: ServiceAuth
  repositoryOwner?: string
  repository?: string
  masterBranch?: string
  commitBranch?: string
  commitMessage?: string
}

export interface PackerOptions {
  projectType?: string
  publisher?: string
  publishOptions?: GithubOptions | PublisherOptions
  assets?: AssetInfo[]
}

export interface GenerateOptions {
  componentType?: string
  componentStyleVariation?: string
}

export enum PublisherType {
  DISK = 'Disk',
  ZIP = 'Zip',
  NOW = 'Now',
  NETLIFY = 'Netlify',
  GITHUB = 'Github',
}

export enum ProjectType {
  REACT = 'React',
  NEXT = 'Next',
  VUE = 'Vue',
  NUXT = 'Nuxt',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
}

export enum ComponentType {
  REACT = 'React',
  VUE = 'Vue',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  ANGULAR = 'Angular',
}
