import { ServiceAuth, AssetInfo } from '@teleporthq/teleport-types'
import { ReactStyleVariation } from '@teleporthq/teleport-component-generator-react'
import { PreactStyleVariation } from '@teleporthq/teleport-component-generator-preact'
import { ReactNativeStyleVariation } from '@teleporthq/teleport-component-generator-reactnative'

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
  projectType?: ProjectType
  publisher?: PublisherType
  publishOptions?: GithubOptions | PublisherOptions
  assets?: AssetInfo[]
}

export type StyleVariation = ReactStyleVariation | PreactStyleVariation | ReactNativeStyleVariation

export interface GenerateOptions {
  componentType?: ComponentType
  styleVariation?: StyleVariation
}

export enum PublisherType {
  DISK = 'Disk',
  ZIP = 'Zip',
  NOW = 'Now',
  NETLIFY = 'Netlify',
  GITHUB = 'Github',
  CODESANDBOX = 'CodeSandbox',
}

export enum ProjectType {
  REACT = 'React',
  NEXT = 'Next',
  VUE = 'Vue',
  NUXT = 'Nuxt',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  REACTNATIVE = 'React Native',
  ANGULAR = 'Angular',
}

export enum ComponentType {
  REACT = 'React',
  VUE = 'Vue',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  ANGULAR = 'Angular',
  REACTNATIVE = 'React Native',
}
