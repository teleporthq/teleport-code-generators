import { EMBED_RUNTIME_FILE_NAME } from '../rich-content-embeds/runtime-module'

/**
 * The code-embed half of the generated `components/rich-text-editor.js`.
 *
 * It is emitted only for projects that actually enable the `tq-embed` format on
 * a rich-text field, so an editor that does not offer embeds is generated
 * exactly as before.
 *
 * Three pieces:
 *  - a Quill block-embed blot whose DOM is the STORED shape, built by the
 *    shared runtime, so what the admin writes is byte-for-byte what the
 *    published page reads;
 *  - a preview pass that mounts sandboxed embeds NEXT TO the block rather than
 *    inside it, because Quill hands its value back as `root.innerHTML` and a
 *    preview mounted inside would be saved to the database;
 *  - a dialog with a Link tab (paste a URL, the provider is recognized) and an
 *    Embed code tab (paste a snippet), plus the caption, width, alignment and
 *    the same-origin opt-in.
 */

/** Quill renders toolbar buttons from `ui/icons`; this is the `</>` glyph. */
const EMBED_TOOLBAR_ICON =
  '<svg viewBox="0 0 18 18">' +
  '<polyline class="ql-even ql-stroke" points="5 7 3 9 5 11"></polyline>' +
  '<polyline class="ql-even ql-stroke" points="13 7 15 9 13 11"></polyline>' +
  '<line class="ql-stroke" x1="11" x2="7" y1="4" y2="14"></line>' +
  '</svg>'

export const EMBED_RUNTIME_IMPORT = `import {
  EMBED_ALIGNMENTS,
  EMBED_ATTR,
  EMBED_BLOT_NAME,
  EMBED_CLASS_NAME,
  EMBED_INITIAL_HEIGHT,
  buildEmbedElementHtml,
  buildEmbedSandboxDocument,
  buildEmbedHtmlFromUrl,
  createEmbedToken,
  createEmbedValue,
  isSafeEmbedUrl,
  normalizeEmbedsForStorage,
  parseEmbedHeightMessage,
  readEmbedValueFromElement,
  readEncodedEmbedCode,
  resolveEmbedSandboxFlags,
} from './${EMBED_RUNTIME_FILE_NAME}'
`

export const EMBED_SUPPORT_SOURCE = `const EMBED_ICON = ${JSON.stringify(EMBED_TOOLBAR_ICON)}

// Tokens minted here, mapped to the preview frame that owns them. A sandboxed
// frame has an opaque origin, so its token is the only safe way to match a
// height message to the frame that sent it.
const embedFramesByToken = {}
let embedBlotRegistered = false

function registerEmbedBlot(Quill) {
  if (!Quill || embedBlotRegistered) {
    return
  }
  embedBlotRegistered = true

  const BlockEmbed = Quill.import('blots/block/embed')

  class TqEmbedBlot extends BlockEmbed {
    static create(value) {
      const holder = document.createElement('div')
      holder.innerHTML = buildEmbedElementHtml(value)
      return holder.firstElementChild
    }

    static value(node) {
      return readEmbedValueFromElement(node)
    }
  }

  TqEmbedBlot.blotName = EMBED_BLOT_NAME
  TqEmbedBlot.tagName = 'FIGURE'
  TqEmbedBlot.className = EMBED_CLASS_NAME

  Quill.register(TqEmbedBlot, true)
  Quill.import('ui/icons')[EMBED_BLOT_NAME] = EMBED_ICON
}

/**
 * Previews go away with the content that held them and never report again, so
 * their tokens are dropped when the next one mounts rather than accumulating
 * for the life of the editor.
 */
function pruneDetachedEmbedFrames() {
  Object.keys(embedFramesByToken).forEach(function (token) {
    if (!embedFramesByToken[token].isConnected) {
      delete embedFramesByToken[token]
    }
  })
}

function readEmbedRatio(block) {
  const raw = block.getAttribute(EMBED_ATTR.RATIO)
  const parsed = raw === null ? NaN : parseFloat(raw)
  return isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Mounts the sandboxed preview as a SIBLING of the embed block, tagged so
 * normalizeEmbedsForStorage can strip it back out before the value is saved.
 */
function mountEmbedPreview(block) {
  const code = readEncodedEmbedCode(block)
  if (!code) {
    return
  }

  pruneDetachedEmbedFrames()

  const token = createEmbedToken()
  const level = block.getAttribute(EMBED_ATTR.SANDBOX) === 'trusted' ? 'trusted' : 'strict'
  const ratio = readEmbedRatio(block)

  const host = document.createElement('div')
  host.setAttribute(EMBED_ATTR.PREVIEW, '1')
  host.setAttribute('contenteditable', 'false')
  host.style.cssText = ratio
    ? 'position:relative;width:100%;padding-top:' + ratio + '%'
    : 'position:relative;width:100%'

  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', resolveEmbedSandboxFlags(level))
  frame.setAttribute('title', block.getAttribute(EMBED_ATTR.CAPTION) || 'Embedded content')
  frame.setAttribute('scrolling', 'no')
  frame.style.cssText = ratio
    ? 'position:absolute;top:0;left:0;width:100%;height:100%;border:0'
    : 'display:block;width:100%;border:0;height:' + EMBED_INITIAL_HEIGHT + 'px'

  if (!ratio) {
    embedFramesByToken[token] = frame
  }

  host.appendChild(frame)
  block.appendChild(host)
  frame.srcdoc = buildEmbedSandboxDocument(code, token)
}

function mountEmbedPreviews(root) {
  if (!root) {
    return
  }

  let blocks
  try {
    blocks = root.querySelectorAll(
      '[' + EMBED_ATTR.MARKER + ']:not([' + EMBED_ATTR.ACTIVATED + '])'
    )
  } catch (err) {
    return
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    block.setAttribute(EMBED_ATTR.ACTIVATED, '1')
    if (block.getAttribute(EMBED_ATTR.MODE) !== 'sandbox') {
      continue
    }
    try {
      mountEmbedPreview(block)
    } catch (err) {
      // A preview that cannot mount must not stop the editor from loading.
    }
  }
}

function applyEmbedHeightMessage(data) {
  const message = parseEmbedHeightMessage(data)
  if (!message) {
    return
  }
  const frame = embedFramesByToken[message.token]
  if (!frame) {
    return
  }
  if (!frame.isConnected) {
    delete embedFramesByToken[message.token]
    return
  }
  frame.style.height = message.height + 'px'
}

/**
 * Quill's value is its live root.innerHTML, which by now carries the preview
 * and the marker that says a block has one. Neither belongs in the database, so
 * the value is normalized on the way out.
 */
function normalizeEmbedsInEditorHtml(html) {
  if (!html || html.indexOf(EMBED_ATTR.MARKER) === -1) {
    return html
  }
  try {
    const holder = document.createElement('div')
    holder.innerHTML = html
    normalizeEmbedsForStorage(holder)
    return holder.innerHTML
  } catch (err) {
    return html
  }
}

/** Inserts at the end of the line the caret is on, never mid-word. */
function embedInsertIndex(editor) {
  const selection = editor.getSelection()
  const end = Math.max(0, editor.getLength() - 1)
  if (!selection || selection.index < 0) {
    return end
  }
  try {
    const found = editor.getLine(selection.index)
    const line = found && found[0]
    const offset = found && found[1]
    if (!line) {
      return end
    }
    return Math.min(selection.index - offset + line.length(), end)
  } catch (err) {
    return end
  }
}

const EMBED_DIALOG_STYLES = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
  },
  panel: {
    background: '#fff',
    borderRadius: '10px',
    width: '100%',
    maxWidth: '560px',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
    color: '#0f172a',
    fontSize: '14px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #e2e8f0',
    fontWeight: 600,
  },
  body: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' },
  tabs: { display: 'flex', gap: '8px' },
  tab: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #cbd5f5',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
  },
  activeTab: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #4f46e5',
    background: '#eef2ff',
    color: '#4338ca',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  label: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' },
  input: {
    padding: '8px 10px',
    border: '1px solid #cbd5f5',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'inherit',
  },
  textarea: {
    padding: '8px 10px',
    border: '1px solid #cbd5f5',
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    minHeight: '140px',
    resize: 'vertical',
  },
  row: { display: 'flex', gap: '12px' },
  hint: { fontSize: '12px', color: '#64748b', lineHeight: 1.5 },
  error: { fontSize: '12px', color: '#b91c1c' },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '16px 20px',
    borderTop: '1px solid #e2e8f0',
  },
  cancel: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid #cbd5f5',
    background: '#fff',
    cursor: 'pointer',
  },
  submit: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid #4f46e5',
    background: '#4f46e5',
    color: '#fff',
    cursor: 'pointer',
  },
}

const EMBED_ALIGN_LABELS = {
  center: 'Center',
  'float-left': 'Wrap left',
  'float-right': 'Wrap right',
}

const EmbedDialog = (props) => {
  const { onCancel, onInsert } = props
  const [tab, setTab] = useState('link')
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [caption, setCaption] = useState('')
  const [width, setWidth] = useState(100)
  const [align, setAlign] = useState('center')
  const [trusted, setTrusted] = useState(false)
  const [error, setError] = useState('')

  const detected = useMemo(() => {
    if (tab !== 'link' || !url.trim()) {
      return null
    }
    return buildEmbedHtmlFromUrl(url.trim())
  }, [tab, url])

  const submit = () => {
    if (tab === 'link') {
      const trimmed = url.trim()
      if (!isSafeEmbedUrl(trimmed)) {
        setError('Enter a full http(s) address.')
        return
      }
      if (!detected) {
        setError('That address cannot be embedded. Paste the embed code instead.')
        return
      }
      onInsert(
        createEmbedValue({
          code: detected.html,
          provider: detected.provider.id,
          url: trimmed,
          ratio: detected.provider.ratio,
          width: width,
          align: align,
          caption: caption,
          sandboxLevel: trusted ? 'trusted' : 'strict',
        })
      )
      return
    }

    const snippet = code.trim()
    if (!snippet) {
      setError('Paste the embed code you were given.')
      return
    }
    onInsert(
      createEmbedValue({
        code: snippet,
        width: width,
        align: align,
        caption: caption,
        sandboxLevel: trusted ? 'trusted' : 'strict',
      })
    )
  }

  return (
    <div style={EMBED_DIALOG_STYLES.backdrop} onMouseDown={onCancel}>
      <div style={EMBED_DIALOG_STYLES.panel} onMouseDown={(event) => event.stopPropagation()}>
        <div style={EMBED_DIALOG_STYLES.header}>
          <span>Add an embed</span>
        </div>
        <div style={EMBED_DIALOG_STYLES.body}>
          <div style={EMBED_DIALOG_STYLES.tabs}>
            <button
              type="button"
              style={tab === 'link' ? EMBED_DIALOG_STYLES.activeTab : EMBED_DIALOG_STYLES.tab}
              onClick={() => { setTab('link'); setError('') }}
            >
              Paste a link
            </button>
            <button
              type="button"
              style={tab === 'code' ? EMBED_DIALOG_STYLES.activeTab : EMBED_DIALOG_STYLES.tab}
              onClick={() => { setTab('code'); setError('') }}
            >
              Embed code
            </button>
          </div>

          {tab === 'link' ? (
            <label style={EMBED_DIALOG_STYLES.label}>
              <span>Address</span>
              <input
                style={EMBED_DIALOG_STYLES.input}
                type="url"
                value={url}
                placeholder="https://www.youtube.com/watch?v=..."
                onChange={(event) => { setUrl(event.target.value); setError('') }}
              />
              <span style={EMBED_DIALOG_STYLES.hint}>
                {detected
                  ? 'Recognized as ' + detected.provider.label + '.'
                  : 'Videos, social posts, maps, forms, design files and code sandboxes.'}
              </span>
            </label>
          ) : (
            <label style={EMBED_DIALOG_STYLES.label}>
              <span>Embed code</span>
              <textarea
                style={EMBED_DIALOG_STYLES.textarea}
                value={code}
                placeholder='<iframe src="..."></iframe>'
                onChange={(event) => { setCode(event.target.value); setError('') }}
              />
              <span style={EMBED_DIALOG_STYLES.hint}>
                Code that runs scripts is placed in a sandboxed frame, so it cannot
                affect the rest of the page.
              </span>
            </label>
          )}

          <label style={EMBED_DIALOG_STYLES.label}>
            <span>Caption (optional)</span>
            <input
              style={EMBED_DIALOG_STYLES.input}
              type="text"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>

          <div style={EMBED_DIALOG_STYLES.row}>
            <label style={{ ...EMBED_DIALOG_STYLES.label, flex: 1 }}>
              <span>Width: {width}%</span>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              />
            </label>
            <label style={{ ...EMBED_DIALOG_STYLES.label, flex: 1 }}>
              <span>Alignment</span>
              <select
                style={EMBED_DIALOG_STYLES.input}
                value={align}
                onChange={(event) => setAlign(event.target.value)}
              >
                {EMBED_ALIGNMENTS.map((value) => (
                  <option key={value} value={value}>
                    {EMBED_ALIGN_LABELS[value] || value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ ...EMBED_DIALOG_STYLES.label, flexDirection: 'row', alignItems: 'flex-start', gap: '8px' }}>
            <input
              type="checkbox"
              checked={trusted}
              onChange={(event) => setTrusted(event.target.checked)}
            />
            <span style={EMBED_DIALOG_STYLES.hint}>
              Allow this embed to use its own cookies and storage. Only needed when a
              widget refuses to load without it, and it gives the embed more access to
              the page.
            </span>
          </label>

          {error ? <span style={EMBED_DIALOG_STYLES.error}>{error}</span> : null}
        </div>
        <div style={EMBED_DIALOG_STYLES.footer}>
          <button type="button" style={EMBED_DIALOG_STYLES.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={EMBED_DIALOG_STYLES.submit} onClick={submit}>
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}
`
