import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { RichTextContentCodegen } from '@teleporthq/teleport-shared'
import { RICH_TEXT_CONTENT_RUNTIME_FILE_NAME } from './content-support-source'

/**
 * Writes `components/rich-text-content.js` into the project, once. EMITTED from
 * `@teleporthq/teleport-shared` rather than written out here, so the stored
 * form a generated editor writes is the one the studio writes, in the same
 * commit.
 */
export const ensureRichTextContentRuntimeModule = (structure: ProjectPluginStructure): void => {
  if (structure.files.has(RICH_TEXT_CONTENT_RUNTIME_FILE_NAME)) {
    return
  }

  structure.files.set(RICH_TEXT_CONTENT_RUNTIME_FILE_NAME, {
    path: ['components'],
    files: [
      {
        name: RICH_TEXT_CONTENT_RUNTIME_FILE_NAME,
        fileType: FileType.JS,
        content: RichTextContentCodegen.generateRichTextContentRuntimeModuleSource(),
      },
    ],
  })
}
