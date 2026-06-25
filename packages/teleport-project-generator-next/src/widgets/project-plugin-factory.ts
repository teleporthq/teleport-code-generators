import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'
import { projectUsesElementTypes } from '../uidl-element-traversal'
import { emitLegacyPeerDepsNpmrc } from '../npmrc-legacy-peer-deps'

export interface WidgetProjectPluginConfig {
  /** Pre-mapping UIDL elementType the export converter emits (e.g. 'qrcode-node'). */
  elementType: string
  /** Generated file name inside /components (e.g. 'tq-qrcode'). */
  fileName: string
  /** Unique key for files.set. */
  fileKey: string
  /** Returns the wrapper component source. */
  generateCode: () => string
  /** npm package the wrapper depends on. */
  dependencyName: string
  /** Exact, pinned version. */
  dependencyVersion: string
  /** Optional global CSS import injected into _app (e.g. a Pickr theme). */
  cssImport?: string
  /**
   * Bump react/react-dom to ^18 when this widget is used (mirrors the calendar
   * plugin). Needed for framer-motion-backed widgets; the template's `next`
   * `^12.1.10` caret already resolves to a React-18-capable 12.3.x.
   */
  bumpReact18?: boolean
}

/**
 * Factory for the npm-backed widget primitives' Next project plugins. Each
 * activates only when the generated project actually uses the primitive, then
 * emits the local wrapper to components/<file>.js, registers the npm dependency,
 * and optionally injects a global stylesheet import into _app. Same shape as
 * NextKanbanProjectPlugin, generalized over the six widgets.
 */
export const createNextWidgetProjectPlugin = (config: WidgetProjectPluginConfig): ProjectPlugin => {
  const elementTypes = new Set([config.elementType])

  return {
    async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
      return structure
    },

    async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
      const { uidl, files, dependencies } = structure

      if (!projectUsesElementTypes(uidl, elementTypes)) {
        return structure
      }

      files.set(config.fileKey, {
        path: ['components'],
        files: [
          {
            name: config.fileName,
            fileType: FileType.JS,
            content: config.generateCode(),
          },
        ],
      })

      dependencies[config.dependencyName] = config.dependencyVersion

      if (config.bumpReact18) {
        dependencies.react = '^18.3.1'
        dependencies['react-dom'] = '^18.3.1'
        // The React-18 bump can clash with template deps that pin React-17 peer
        // ranges (e.g. dangerous-html for embeds) — relax peer resolution so the
        // install survives, exactly like the kanban widget.
        emitLegacyPeerDepsNpmrc(structure, `${config.fileKey}-npmrc`)
      }

      if (config.cssImport) {
        injectImportIntoApp(structure, config.cssImport)
      }

      return structure
    },
  }
}
