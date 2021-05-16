import path from 'path'
import fetch from 'node-fetch'
import { ensureDirSync } from 'fs-extra'
import {
  CompiledComponent,
  ComponentType,
  ComponentUIDL,
  ProjectType,
  ProjectUIDL,
  VComponentUIDL,
  VProjectUIDL,
  GeneratedFolder,
  FileType,
} from '@teleporthq/teleport-types'
import { generateComponent, packProject } from '@teleporthq/teleport-code-generator'
import { injectFilesFromSubFolder, injectFilesToPath, findFileByName } from './file'
import {
  BASE_URL,
  STUDIO_URL,
  UUDID_REGEX,
  CONFIG_FILE_NAME,
  DEFALT_CONFIG_TEMPLATE,
  DefaultConfigTemplate,
  DEFAULT_CONFIG_FILE_NAME,
} from '../constants'
import { getPackageJSON } from '../utils'

export const fetchUIDLFromREPL = async (url: string): Promise<Record<string, unknown>> => {
  const id = url.match(UUDID_REGEX)[0]
  const result = await fetch(`${BASE_URL}fetch-uidl/${id}`)
  if (result.status !== 200) {
    throw new Error(`Failed in fetch UIDL - ${JSON.stringify(result, null, 2)}`)
  }
  const jsonData = await result.json()
  return JSON.parse(jsonData.uidl)
}

export const fetchSnapshotFromPlayground = async (slug: string) => {
  const result = await fetch(`${STUDIO_URL}${slug}/snapshot`)
  const jsonData = await result.json()
  return jsonData
}

export const generateComponentFromUIDL = async (
  uidl: VComponentUIDL,
  componentType: ComponentType = ComponentType.REACT
): Promise<CompiledComponent> => {
  const result = await generateComponent(uidl as ComponentUIDL, {
    componentType,
  })
  return result
}

export const generateProjectFromUIDL = async ({
  uidl,
  projectType,
  targetPath,
  url,
  force = false,
}: {
  uidl: VProjectUIDL
  projectType: ProjectType
  targetPath: string
  url: string
  force?: boolean
}): Promise<string> => {
  ensureDirSync(path.join(process.cwd(), targetPath))

  const { success, payload } = (await packProject(uidl as ProjectUIDL, {
    projectType,
    publishOptions: {
      outputPath: targetPath,
    },
  })) as { success: boolean; payload: GeneratedFolder }
  if (success) {
    const { files, subFolders } = payload as GeneratedFolder
    let { name } = payload as GeneratedFolder
    const packageJSON = getPackageJSON()
    const teleportConfig = findFileByName(DEFAULT_CONFIG_FILE_NAME)

    if (uidl?.name && uidl.name.length > 0) {
      name = uidl.name
    }

    if (packageJSON?.name) {
      name = packageJSON?.name as string
    }

    if (teleportConfig && (JSON.parse(teleportConfig) as DefaultConfigTemplate)?.project?.name) {
      name = (JSON.parse(teleportConfig) as DefaultConfigTemplate)?.project.name
    }

    files.push({
      name: CONFIG_FILE_NAME,
      fileType: FileType.JSON,
      content: JSON.stringify(
        {
          ...DEFALT_CONFIG_TEMPLATE,
          project: { url, projectType, name },
        } as DefaultConfigTemplate,
        null,
        2
      ),
    })

    injectFilesFromSubFolder({
      folder: subFolders,
      targetPath: path.join(targetPath, name),
      force,
    })

    files.forEach((file) => {
      injectFilesToPath({
        rootFolder: process.cwd(),
        targetPath: path.join(targetPath, name),
        files: [file],
        force,
      })
    })

    return name
  }
}
