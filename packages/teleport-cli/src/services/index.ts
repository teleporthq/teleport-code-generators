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
import { injectFilesFromSubFolder, injectFilesToPath } from './file'
import {
  BASE_URL,
  STUDIO_URL,
  UUDID_REGEX,
  CONFIG_FILE_NAME,
  DEFALT_CONFIG_TEMPLATE,
  DefaultConfigTemplate,
} from '../constants'

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
}) => {
  try {
    ensureDirSync(path.join(process.cwd(), targetPath))
    const { success, payload } = (await packProject(uidl as ProjectUIDL, {
      projectType,
      publishOptions: {
        outputPath: targetPath,
      },
    })) as { success: boolean; payload: GeneratedFolder }
    if (success) {
      const { files, subFolders, name } = payload as GeneratedFolder
      files.push({
        name: CONFIG_FILE_NAME,
        fileType: FileType.JSON,
        content: JSON.stringify(
          {
            ...DEFALT_CONFIG_TEMPLATE,
            project: { url, projectType, name: files[0].name },
          } as DefaultConfigTemplate,
          null,
          2
        ),
      })
      injectFilesFromSubFolder(subFolders, path.join(targetPath, name), force)
      files.forEach((file) => {
        injectFilesToPath(process.cwd(), path.join(targetPath, name), [file], force)
      })
    }
  } catch (e) {
    console.warn(e)
  }
}
