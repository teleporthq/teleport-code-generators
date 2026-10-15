/**
 * Code-generation half of the rich-text content contract. Kept apart from
 * `rich-text-content.ts` on purpose: that module is imported by the studio
 * editor and the canvas renderer, which are browser bundles. Only the project
 * generator imports this file.
 */
import { RICH_TEXT_CONTENT_RUNTIME_MODULE_SOURCE } from './rich-text-content-runtime-source'

/**
 * `components/rich-text-content.js` for the generated project: the converter
 * its rich-text editor runs on the way in and out, and the protected block's
 * helpers. A STRING committed beside this file for the same reason the embed
 * runtime is (`generateEmbedRuntimeModuleSource`): the generator runs inside a
 * minified bundle where `Function.prototype.toString` prints renamed code.
 * `__tests__/utils/rich-text-content-runtime-module.ts` fails when the string
 * drifts from `rich-text-content.ts` and regenerates it with
 * UPDATE_RICH_TEXT_CONTENT_RUNTIME=1.
 */
export function generateRichTextContentRuntimeModuleSource(): string {
  return RICH_TEXT_CONTENT_RUNTIME_MODULE_SOURCE
}

const RENDER_TIME_NAMES = [
  'QUILL_LIST_ITEM_ATTR',
  'escapeRichTextText',
  'buildCodeBlockHtml',
  'normalizeLegacyRichTextHtml',
  'rebuildQuillListHtml',
  'rebuildQuillCodeBlockHtml',
  'mergeBlockquoteLines',
]

/**
 * The string-only half of the contract as plain declarations, for the data
 * modules a generated page runs in `getStaticProps`: a post stored before the
 * contract (the studio's flat list lines, the admin panel's no-break spaces)
 * renders as stored HTML would, without waiting for its next save. Cut from
 * the committed runtime module, so it can never drift from it.
 */
export function generateLegacyRichTextNormalizerCode(): string {
  const chunks = RICH_TEXT_CONTENT_RUNTIME_MODULE_SOURCE.split(/\n\n(?=export )/)
  const picked = RENDER_TIME_NAMES.map((name) => {
    const chunk = chunks.find((candidate) =>
      new RegExp(`^export (?:var|function) ${name}\\b`).test(candidate)
    )
    if (!chunk) {
      throw new Error(`Rich-text content runtime has no ${name} to cut for the data module`)
    }
    return chunk.replace(/^export /, '').replace(/\n$/, '')
  })
  return picked.join('\n\n')
}
