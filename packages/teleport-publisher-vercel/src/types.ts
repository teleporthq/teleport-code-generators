import { GeneratedFolder } from '@teleporthq/teleport-types'

export interface ProjectFolderInfo {
  folder: GeneratedFolder
  prefix?: string
  files?: VercelFile[]
  ignoreFolder?: boolean
}

export interface VercelFile {
  file: string
  data?: Blob | string
  sha?: string
  size?: number
  encoding?: string
}

export interface VercelPayload {
  files: VercelFile[]
  projectSettings: {
    framework: string
  }
  name: string
  version: number
  public?: boolean
  target?: string
  alias?: string[]
}
