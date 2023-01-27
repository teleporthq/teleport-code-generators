import path, { join } from 'path'
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
  GeneratedFile,
  ProjectPlugin,
} from '@teleporthq/teleport-types'
import { generateComponent, packProject } from '@teleporthq/teleport-code-generator'
import { injectFilesFromSubFolder, injectFilesToPath } from './file'
import { CONFIG_FILE, LOCK_FILE_TEMPLATE, DefaultConfigTemplate } from '../constants'
import { pluginCustomMode } from './custom-mode-project-plugin'
import { pack } from './helper'

export interface TeleportCLIPluginParams {
  folder: GeneratedFolder
}

export interface TeleportCLIPlugin {
  runBefore: () => Promise<{ projectPlugins: ProjectPlugin[] }>
  runAfter: (params: TeleportCLIPluginParams) => Promise<TeleportCLIPluginParams>
}

export interface TeleportCLIConfig {
  plugins: TeleportCLIPlugin[]
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

export const generateProjectFromUIDL = async (params: {
  uidl: VProjectUIDL
  projectType: ProjectType
  targetPath: string
  url: string
  force?: boolean
  customModeFiles?: Record<string, { code: string }>
}): Promise<string> => {
  const { uidl, projectType, targetPath, url, customModeFiles = {} } = params
  ensureDirSync(path.join(process.cwd(), targetPath))

  const plugins: ProjectPlugin[] = []
  let customConfig: TeleportCLIConfig
  try {
    customConfig = (await import(`${join(process.cwd(), 'teleport.config')}`)) as TeleportCLIConfig
    for (const plugin of customConfig.plugins) {
      const { projectPlugins = [] } = await plugin.runBefore()
      plugins.push(...projectPlugins)
    }
  } catch (e) {
    /* Config doesn't exist */
  }

  if (Object.keys(customModeFiles).length > 0) {
    plugins.push(pluginCustomMode)
  }

  const { success, payload } = (await packProject(uidl as ProjectUIDL, {
    projectType,
    publishOptions: {
      outputPath: targetPath,
    },
    plugins,
  })) as unknown as { success: boolean; payload: GeneratedFolder }

  if (success) {
    const { name } = payload
    injectGeneratedFolderInto({ folder: payload, url, targetPath }, customConfig)

    if (customModeFiles) {
      injectGeneratedFolderInto({ folder: pack(customModeFiles), url, targetPath })
    }

    return name
  }
}

export const injectGeneratedFolderInto = async (
  params: {
    folder: GeneratedFolder
    targetPath: string
    force?: boolean
    url: string
  },
  customConfig?: TeleportCLIConfig
) => {
  const { force = false, url, targetPath } = params
  let { folder } = params

  if (customConfig) {
    try {
      for (const plugin of customConfig.plugins) {
        const result = await plugin.runAfter({ folder })
        folder = result.folder
      }
    } catch (e) {
      /* tslint:disable-next-line:no-console */
      console.error(e)
    }
  }

  folder.files.push({
    name: CONFIG_FILE,
    content: JSON.stringify(
      {
        ...LOCK_FILE_TEMPLATE,
        project: { url, projectType: ProjectType.REACT },
      } as DefaultConfigTemplate,
      null,
      2
    ),
  })

  injectFilesFromSubFolder({
    folder: folder.subFolders,
    targetPath: path.join(targetPath, ''),
    force,
  })

  folder.files.forEach((file: GeneratedFile) => {
    injectFilesToPath({
      rootFolder: process.cwd(),
      targetPath: path.join(targetPath, ''),
      files: [file],
      force,
    })
  })
}
