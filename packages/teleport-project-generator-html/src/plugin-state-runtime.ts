import { GenericUtils, StateBindings } from '@teleporthq/teleport-shared'
import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'
import { appendGlobalCss, insertBeforeClosingTag } from './global-css'
import { STATE_RUNTIME_CSS, STATE_RUNTIME_SCRIPT } from './state/runtime-script'

/**
 * Conditions, clicks and state classes in the static HTML export: a downloaded
 * site opens its menus, switches its tabs and restyles its buttons the way the
 * Next export does. The generator writes the bindings into the markup; this
 * plugin ships the one script that runs them (`tq-state.js`, next to the
 * stylesheet), links it from every document that carries a binding, and adds
 * the one rule that keeps a hidden branch hidden.
 *
 * Nothing is emitted for a project without bindings.
 */

const FILES_KEY = 'tq-state-runtime'

const bindsState = (file: GeneratedFile) =>
  file.fileType === FileType.HTML && file.content.includes(`${StateBindings.SCOPE_ATTR}=`)

const linkRuntime = (structure: ProjectPluginStructure, runtimePath: string[]): void => {
  structure.files.forEach((entry, key) => {
    if (key === FILES_KEY) {
      return
    }
    // The strategy spells "the project root" as [''], which would print `..//`.
    const prefix = GenericUtils.generateLocalDependenciesPrefix(
      entry.path.filter(Boolean),
      runtimePath.filter(Boolean)
    )
    const tag = `<script defer src="${prefix}${StateBindings.RUNTIME_FILE_NAME}.js"></script>\n`
    structure.files.set(key, {
      ...entry,
      files: entry.files.map((file: GeneratedFile) => {
        // A component fragment has no head and is never linked.
        const linked = bindsState(file)
          ? insertBeforeClosingTag(file.content, 'head', tag)
          : undefined
        return linked === undefined ? file : { ...file, content: linked }
      }),
    })
  })
}

export class ProjectPluginStateRuntime implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const usesState = Array.from(structure.files.values()).some((entry) =>
      entry.files.some(bindsState)
    )
    if (!usesState) {
      return structure
    }
    appendGlobalCss(structure, STATE_RUNTIME_CSS)
    const runtimePath = structure.strategy.projectStyleSheet?.path ?? ['']
    structure.files.set(FILES_KEY, {
      path: runtimePath,
      files: [
        {
          name: StateBindings.RUNTIME_FILE_NAME,
          fileType: FileType.JS,
          content: STATE_RUNTIME_SCRIPT,
        },
      ],
    })
    linkRuntime(structure, runtimePath)
    return structure
  }
}

export const pluginStateRuntime = new ProjectPluginStateRuntime()
