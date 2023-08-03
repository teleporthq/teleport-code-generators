import { GeneratedFile, GeneratedFolder, VercelDeployResponse } from '@teleporthq/teleport-types'

export interface ProjectFolderInfo {
  folder: GeneratedFolder
  prefix?: string
  files?: GeneratedFile[]
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

export type VercelResponse = VercelDeployResponse | VercelError

export interface VercelError {
  error: {
    code: string
    message: string
    errors?: string[]
  }
}
