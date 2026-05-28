import { GenericUtils } from '@teleporthq/teleport-shared'
import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'

interface RichTextEditorComponentPluginConfig {
  /**
   * The base output path for the generator using this plugin.
   * For pages: ['pages']
   * For components: ['components']
   */
  basePath: string[]
}

/**
 * Component-level plugin that adjusts the RichTextEditor local dependency
 * path based on the component's actual output location.
 *
 * This is necessary because the element mapping uses a fixed local path,
 * but pages can be nested (e.g., /pages/blog/[id].js) which changes the
 * relative path to the components directory.
 */
export const createRichTextEditorComponentPlugin: ComponentPluginFactory<
  RichTextEditorComponentPluginConfig
> = (config) => {
  const { basePath = ['pages'] } = config || {}

  const plugin: ComponentPlugin = async (structure) => {
    const { dependencies, uidl } = structure

    const dep = dependencies.RichTextEditor
    if (!dep || dep.type !== 'local') {
      return structure
    }

    const folderPath = uidl.outputOptions?.folderPath || []
    const fromPath = [...basePath, ...folderPath]
    const toPath = ['components']

    const relativePath = GenericUtils.generateLocalDependenciesPrefix(fromPath, toPath)
    dep.path = `${relativePath}rich-text-editor`

    return structure
  }

  return plugin
}
