import { GeneratedFolder } from '@teleporthq/teleport-types'

export interface ProjectFolderInfo {
  folder: GeneratedFolder
  prefix?: string
  files?: NowFile[]
  ignoreFolder?: boolean
}

export interface NowFile {
  file: string
  data: Blob | string
  encoding?: string
}

export interface NowPayload {
  files: NowFile[]
  name: string
  version: number
  public?: boolean
  target?: string
  alias?: string[]
}
