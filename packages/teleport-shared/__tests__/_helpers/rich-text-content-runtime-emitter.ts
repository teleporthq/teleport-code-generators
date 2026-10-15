/**
 * Prints `components/rich-text-content.js` from the live functions in
 * `src/utils/rich-text-content.ts`, the way `embed-runtime-emitter.ts` prints
 * the embed runtime: test-only, with the result committed as the string in
 * `src/utils/rich-text-content-runtime-source.ts` that the generator ships.
 * `__tests__/utils/rich-text-content-runtime-module.ts` compares the two and
 * rewrites the committed copy when run with UPDATE_RICH_TEXT_CONTENT_RUNTIME=1.
 */
import * as RichTextContent from '../../src/utils/rich-text-content'

const CONSTANT_NAMES = [
  'PROTECTED_BLOCK_CLASS',
  'PROTECTED_BLOCK_ATTR',
  'PROTECTED_BLOCK_BLOT_NAME',
  'PROTECTED_BLOCK_KINDS',
  'CALLOUT_CLASS',
  'CALLOUT_KIND_ATTR',
  'CALLOUT_KINDS',
  'RICH_TEXT_EMBED_CLASS',
  'RICH_TEXT_IMAGE_CLASS',
  'QUILL_LIST_ITEM_ATTR',
  'QUILL_INDENT_CLASS_PREFIX',
  'RICH_TEXT_INLINE_TAGS',
  'RICH_TEXT_BLOCK_TAGS',
] as const

/** Every exported function, in source order: they only ever call each other and the constants. */
const FUNCTION_NAMES = [
  'parseRichTextFragment',
  'escapeRichTextText',
  'escapeRichTextAttribute',
  'isProtectedBlockKind',
  'buildProtectedBlockHtml',
  'readProtectedBlockValue',
  'isCalloutKind',
  'buildCalloutHtml',
  'buildCodeBlockHtml',
  'hasClass',
  'isRichTextInlineNode',
  'isBlankTextNode',
  'isRichTextBlockElement',
  'stripInterBlockWhitespace',
  'unwrapSingleParagraphListItems',
  'isExternalWebLink',
  'normalizeLinkTargets',
  'wrapBareBlockquoteContent',
  'serializeRichTextNode',
  'readInlineHtml',
  'isQuillSimpleList',
  'flattenListForQuill',
  'isQuillSimpleBlockquote',
  'blockquoteLinesForQuill',
  'protectedKindForElement',
  'toEditorHtml',
  'fromEditorHtml',
  'toCanonicalRichTextHtml',
  'trimEmptyEdgeParagraphs',
  'normalizeLegacyRichTextHtml',
  'rebuildQuillListHtml',
  'rebuildQuillCodeBlockHtml',
  'mergeBlockquoteLines',
] as const

const bindRuntimeConstantReferences = (source: string, names: readonly string[]): string =>
  names.reduce((acc, name) => acc.replace(new RegExp(`\\bexports\\.${name}\\b`, 'g'), name), source)

const RUNTIME_MODULE_HEADER = `/**
 * Rich-text content: the stored form of a post body and the form the editor
 * holds. Generated from @teleporthq/teleport-shared; edit it there.
 *
 * Stored HTML is plain: nested lists, tables with header rows, code blocks,
 * callouts. The editor gets lists as Quill's lines and every block Quill has
 * no blot for wrapped in a protected block it treats as one unit, and writes
 * stored HTML back through fromEditorHtml.
 */
`

export function emitRichTextContentRuntimeModuleSourceFromFunctions(): string {
  const module = RichTextContent as unknown as Record<string, unknown>
  const declarations = CONSTANT_NAMES.map(
    (name) => `export var ${name} = ${JSON.stringify(module[name], null, 2)}`
  )
  const missing = FUNCTION_NAMES.filter((name) => typeof module[name] !== 'function')
  const unlisted = Object.keys(module).filter(
    (name) =>
      typeof module[name] === 'function' &&
      (FUNCTION_NAMES as readonly string[]).indexOf(name) === -1
  )
  if (missing.length || unlisted.length) {
    throw new Error(
      `Rich-text content runtime: functions missing ${JSON.stringify(
        missing
      )}, unlisted ${JSON.stringify(unlisted)}`
    )
  }
  const functions = FUNCTION_NAMES.map(
    (name) =>
      `export ${bindRuntimeConstantReferences(
        (module[name] as () => void).toString(),
        CONSTANT_NAMES
      )}`
  )

  const source = `${RUNTIME_MODULE_HEADER}\n${declarations.join('\n\n')}\n\n${functions.join(
    '\n\n'
  )}\n`

  const leaked = source.match(/\bexports\.[A-Za-z_$][\w$]*/g)
  if (leaked) {
    throw new Error(
      `Rich-text content runtime cannot be emitted: unresolved module references ${leaked.join(
        ', '
      )}`
    )
  }
  return source
}
