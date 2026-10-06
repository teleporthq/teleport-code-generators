import { RichTextContent } from '@teleporthq/teleport-shared'

/** `components/rich-text-content.js` — the stored-form contract every rich-text editor shares. */
export const RICH_TEXT_CONTENT_RUNTIME_FILE_NAME = 'rich-text-content'

export const CONTENT_RUNTIME_IMPORT = `import {
  PROTECTED_BLOCK_BLOT_NAME,
  PROTECTED_BLOCK_CLASS,
  buildProtectedBlockHtml,
  readProtectedBlockValue,
  toEditorHtml,
  fromEditorHtml,
} from './${RICH_TEXT_CONTENT_RUNTIME_FILE_NAME}'
`

/**
 * The look of a protected block inside the admin editor: the stored table,
 * code block or callout drawn as it is, outlined as one unit on hover. Global,
 * because Quill renders the content outside this component's own scope.
 */
const PROTECTED_BLOCK_STYLES = `
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} { position: relative; margin: 10px 0; border-radius: 4px; outline: 1px dashed transparent; outline-offset: 3px; cursor: default; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS}:hover { outline-color: #9ca3af; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} table { border-collapse: collapse; width: 100%; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} th, .ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} th { background: #f3f4f6; font-weight: 600; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} pre { margin: 0; padding: 10px 12px; background: #f3f4f6; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; white-space: pre; overflow-x: auto; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} .${RichTextContent.CALLOUT_CLASS} { padding: 10px 12px 10px 14px; border-left: 3px solid #6366f1; background: #f3f4f6; border-radius: 0 4px 4px 0; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} .${RichTextContent.CALLOUT_CLASS}::before { content: attr(${RichTextContent.CALLOUT_KIND_ATTR}); display: block; margin-bottom: 4px; font-size: 11px; font-weight: 700; text-transform: capitalize; color: #4f46e5; }
.ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} ul, .ql-editor .${RichTextContent.PROTECTED_BLOCK_CLASS} ol { padding-left: 22px; }
`

/**
 * What the generated editor needs beside the runtime module: the protected
 * block registered as a Quill block embed, the format list widened so inline
 * code and the block are never stripped on load, and the block's styles.
 */
export const CONTENT_SUPPORT_SOURCE = `const RICH_TEXT_CONTENT_STYLES = ${JSON.stringify(
  PROTECTED_BLOCK_STYLES
)}

let protectedBlockBlotRegistered = false

// A table, a code block, a callout or any block Quill has no blot for arrives
// wrapped as one protected block (see rich-text-content.js). Registered as a
// block embed, it is one atomic unit to the editor and what it holds is never
// rewritten.
function registerProtectedBlockBlot(Quill) {
  if (!Quill || protectedBlockBlotRegistered) {
    return
  }
  protectedBlockBlotRegistered = true

  const BlockEmbed = Quill.import('blots/block/embed')

  class TqProtectedBlockBlot extends BlockEmbed {
    static create(value) {
      const holder = document.createElement('div')
      holder.innerHTML = buildProtectedBlockHtml(value.kind, value.html)
      return holder.firstElementChild
    }

    static value(node) {
      return readProtectedBlockValue(node)
    }
  }

  TqProtectedBlockBlot.blotName = PROTECTED_BLOCK_BLOT_NAME
  TqProtectedBlockBlot.tagName = 'DIV'
  TqProtectedBlockBlot.className = PROTECTED_BLOCK_CLASS
  Quill.register(TqProtectedBlockBlot, true)
}

// The field's own format list decides the toolbar; what Quill is ALLOWED to
// hold also includes inline code and the protected block, or a loaded post
// would lose them on the way in.
function editorFormatsFor(formats) {
  if (!Array.isArray(formats) || formats.length === 0) {
    return formats
  }
  const widened = formats.slice()
  if (!widened.includes('code')) {
    widened.push('code')
  }
  if (!widened.includes(PROTECTED_BLOCK_BLOT_NAME)) {
    widened.push(PROTECTED_BLOCK_BLOT_NAME)
  }
  return widened
}
`
