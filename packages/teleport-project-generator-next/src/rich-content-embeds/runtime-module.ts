import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { RichTextEmbedsCodegen } from '@teleporthq/teleport-shared'

/** `components/embed-runtime.js` — the shared half of the code-embed feature. */
export const EMBED_RUNTIME_FILE_NAME = 'embed-runtime'

/**
 * Writes the embed runtime module into the project, once. Both the activator
 * (which mounts sandboxed embeds on a rendered page) and the rich-text editor
 * (which creates them) import it, so whichever project plugin runs first puts
 * it there and the second one finds it already present.
 *
 * The module is EMITTED from `@teleporthq/teleport-shared` rather than written
 * out here, so a provider added to the registry reaches the generated project
 * and the studio editor in the same commit.
 */
export const ensureEmbedRuntimeModule = (structure: ProjectPluginStructure): void => {
  if (structure.files.has(EMBED_RUNTIME_FILE_NAME)) {
    return
  }

  structure.files.set(EMBED_RUNTIME_FILE_NAME, {
    path: ['components'],
    files: [
      {
        name: EMBED_RUNTIME_FILE_NAME,
        fileType: FileType.JS,
        content: RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource(),
      },
    ],
  })
}
