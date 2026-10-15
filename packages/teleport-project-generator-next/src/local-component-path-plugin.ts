import { GenericUtils } from '@teleporthq/teleport-shared'
import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'

interface LocalComponentPathPluginConfig {
  /**
   * The base output path for the generator using this plugin.
   * For pages: ['pages']
   * For components: ['components']
   */
  basePath: string[]
  /**
   * Local component name → generated file name inside /components
   * (e.g. TqKanban → 'tq-kanban' for components/tq-kanban.js).
   */
  componentFiles: Record<string, string>
}

/**
 * Component-level plugin that adjusts local component dependency paths based
 * on the component's actual output location.
 *
 * The element mappings use a fixed '../components/<file>' path, but pages can
 * be nested (e.g. /pages/blog/[id].js), which changes the relative path to
 * the components directory. Same mechanism as the rich-text-editor path
 * plugin, generalized over a set of local components.
 */
export const createLocalComponentPathPlugin: ComponentPluginFactory<
  LocalComponentPathPluginConfig
> = (config) => {
  const { basePath = ['pages'], componentFiles = {} } = config || {}

  const plugin: ComponentPlugin = async (structure) => {
    const { dependencies, uidl } = structure

    const folderPath = uidl.outputOptions?.folderPath || []
    const fromPath = [...basePath, ...folderPath]
    const toPath = ['components']

    for (const [componentName, fileName] of Object.entries(componentFiles)) {
      const dep = dependencies[componentName]
      if (!dep || dep.type !== 'local') {
        continue
      }

      const relativePath = GenericUtils.generateLocalDependenciesPrefix(fromPath, toPath)
      dep.path = `${relativePath}${fileName}`
    }

    return structure
  }

  return plugin
}

/** Local components emitted by the drag-drop, kanban and widget project plugins. */
export const INTERACTIVE_PRIMITIVE_COMPONENT_FILES: Record<string, string> = {
  TqDragArea: 'tq-drag-drop',
  TqDraggable: 'tq-drag-drop',
  TqDroppable: 'tq-drag-drop',
  TqSortable: 'tq-drag-drop',
  TqSortableItem: 'tq-drag-drop',
  TqKanban: 'tq-kanban',
  TqQrCode: 'tq-qrcode',
  TqBarcode: 'tq-barcode',
  TqSignature: 'tq-signature',
  TqColorPicker: 'tq-color-picker',
  TqEmojiPicker: 'tq-emoji-picker',
  TqMotion: 'tq-motion',
  TqScrollScene: 'tq-scroll-scene',
  TqScrollVideo: 'tq-scroll-video',
  TqCountdown: 'tq-countdown',
  TqFormFileInput: 'tq-form-file-input',
  TqCategoriesMegamenu: 'tq-categories-megamenu',
  TqCategoriesFilter: 'tq-categories-filter',
}
