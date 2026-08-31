import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'
import {
  PAGINATION_SCROLL_IMPORT,
  PAGINATION_SCROLL_RUNTIME_DIR,
  PAGINATION_SCROLL_RUNTIME_MODULE,
} from './constants'
import { PAGINATION_SCROLL_RUNTIME_JS } from './pagination-scroll-runtime'
import { markPaginationNodesInProject, projectHasPaginationMarkers } from './uidl-markers'

/**
 * Scrolls the visitor back to the start of a paginated array mapper's list
 * whenever they page through it.
 *
 * The two halves have to run at different points in the pipeline:
 *
 * - `runBefore` stamps the `data-*` markers onto the UIDL, because the emitted
 *   JSX is built from it during component generation. Marking the elements
 *   here rather than in the JSX plugin also covers every mapper in the project
 *   at once — pages and components alike — off a single element type.
 * - `runAfter` ships the runtime and imports it from `_app`, the same way the
 *   play-sound interaction ships its delegated listener. `_app` only exists as
 *   a generated file at that point.
 *
 * Both are gated on the project actually having a pagination block, so a
 * project without one gets neither the attributes nor the extra bytes. The
 * gate in `runAfter` reads the marker rather than the element type: by then the
 * UIDL has been through the resolver, which replaces `cms-pagination-node` with
 * its semantic type.
 */
export class NextPaginationScrollProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    markPaginationNodesInProject(structure.uidl)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { files, uidl } = structure

    if (!projectHasPaginationMarkers(uidl)) {
      return structure
    }

    files.set('pagination-scroll-runtime', {
      path: PAGINATION_SCROLL_RUNTIME_DIR,
      files: [
        {
          name: PAGINATION_SCROLL_RUNTIME_MODULE,
          fileType: FileType.JS,
          content: PAGINATION_SCROLL_RUNTIME_JS,
        },
      ],
    })

    injectImportIntoApp(structure, PAGINATION_SCROLL_IMPORT)

    return structure
  }
}
