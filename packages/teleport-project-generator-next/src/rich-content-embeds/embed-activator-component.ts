import { EMBED_RUNTIME_FILE_NAME } from './runtime-module'

/**
 * Source of the generated `components/rich-content-embeds.js` — a
 * null-rendering client component, mounted once in `_app`, that brings code
 * embeds inside rich-text CONTENT to life.
 *
 * Why it has to exist at all: a content column bound into a page is emitted as
 * `<span dangerouslySetInnerHTML={{ __html: post.content }} />`. That renders an
 * `<iframe>` perfectly well, but it can never run a `<script>` —
 * innerHTML-inserted scripts are inert by specification. So an embed is stored
 * in one of two shapes (see `components/embed-runtime.js`):
 *
 *   - `inline`  — passive markup, already in the page, nothing to do here. It
 *                 renders server-side and works with JavaScript disabled.
 *   - `sandbox` — the markup is base64-encoded on the element and this
 *                 component mounts it inside a sandboxed iframe, so
 *                 author-supplied JavaScript runs in an opaque origin and can
 *                 never reach the hosting page.
 *
 * Everything that decides BEHAVIOUR — the sandbox flags, the document handed to
 * the frame, the height protocol and its bounds — comes from the shared runtime
 * module. Only the wiring is written here, and three parts of it are
 * load-bearing:
 *   - a mutation observer, because content arrives after the first paint and
 *     React replaces the whole `innerHTML` when the post changes, taking every
 *     mounted iframe with it;
 *   - a `routeChangeComplete` hook, for a client-side navigation between posts;
 *   - an `activated` marker per block, so the two firing together mount once.
 */
export const generateRichContentEmbedsComponentCode = (): string => {
  return `import { useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  EMBED_ATTR,
  EMBED_FRAME_CLASS_NAME,
  EMBED_INITIAL_HEIGHT,
  buildEmbedSandboxDocument,
  createEmbedToken,
  parseEmbedHeightMessage,
  readEncodedEmbedCode,
  resolveEmbedSandboxFlags,
} from './${EMBED_RUNTIME_FILE_NAME}'

// Tokens this page minted, mapped to the frame that owns them. A sandboxed
// frame has an opaque origin, so \`event.origin\` cannot identify it — matching
// on a token generated here is what makes the height message safe to act on.
const framesByToken = {}

/**
 * Frames go away with the content that held them and never report again, so
 * their tokens are dropped on the next pass rather than accumulating for the
 * life of the session.
 */
function pruneDetachedFrames() {
  Object.keys(framesByToken).forEach(function (token) {
    if (!framesByToken[token].isConnected) {
      delete framesByToken[token]
    }
  })
}

function readRatio(block) {
  const raw = block.getAttribute(EMBED_ATTR.RATIO)
  const parsed = raw === null ? NaN : parseFloat(raw)
  return isFinite(parsed) && parsed > 0 ? parsed : null
}

function applyHeightMessage(data) {
  const message = parseEmbedHeightMessage(data)
  if (!message) {
    return
  }
  const frame = framesByToken[message.token]
  if (!frame) {
    return
  }
  if (!frame.isConnected) {
    delete framesByToken[message.token]
    return
  }
  frame.style.height = message.height + 'px'
}

function mountSandboxedEmbed(block) {
  const code = readEncodedEmbedCode(block)
  if (!code) {
    return
  }

  const host = block.querySelector('.' + EMBED_FRAME_CLASS_NAME)
  if (!host) {
    return
  }

  const token = createEmbedToken()
  const ratio = readRatio(block)
  const level = block.getAttribute(EMBED_ATTR.SANDBOX) === 'trusted' ? 'trusted' : 'strict'

  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', resolveEmbedSandboxFlags(level))
  frame.setAttribute('loading', 'lazy')
  frame.setAttribute('title', block.getAttribute(EMBED_ATTR.CAPTION) || 'Embedded content')
  frame.setAttribute('scrolling', 'no')
  // A ratio means the block already reserves the space, so the frame just fills
  // it and never needs to report a height. Without one the frame starts at a
  // neutral height and grows to whatever it reports back.
  frame.style.cssText = ratio
    ? 'position:absolute;top:0;left:0;width:100%;height:100%;border:0'
    : 'display:block;width:100%;border:0;height:' + EMBED_INITIAL_HEIGHT + 'px'

  if (!ratio) {
    framesByToken[token] = frame
  }

  // The <noscript> fallback has done its job by the time we get here.
  host.textContent = ''
  host.appendChild(frame)
  frame.srcdoc = buildEmbedSandboxDocument(code, token)
}

function activateEmbeds() {
  pruneDetachedFrames()

  let blocks
  try {
    // Only what still needs mounting: the pass then costs nothing once every
    // block is handled, and re-entering from the observer settles immediately.
    blocks = document.querySelectorAll(
      '[' + EMBED_ATTR.MARKER + ']:not([' + EMBED_ATTR.ACTIVATED + '])'
    )
  } catch (err) {
    return
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    // Marked before the work, not after: mounting the iframe is itself a
    // mutation the observer sees, and an unmarked block would be picked up
    // again on that pass.
    block.setAttribute(EMBED_ATTR.ACTIVATED, '1')

    if (block.getAttribute(EMBED_ATTR.MODE) !== 'sandbox') {
      continue
    }
    try {
      mountSandboxedEmbed(block)
    } catch (err) {
      // One broken embed must never take the page down with it.
    }
  }
}

const RichContentEmbeds = () => {
  const router = useRouter()

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) {
        return
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0
        activateEmbeds()
      })
    }

    const onMessage = (event) => {
      applyHeightMessage(event.data)
    }

    activateEmbeds()
    window.addEventListener('message', onMessage)

    let observer = null
    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
    }

    router.events.on('routeChangeComplete', schedule)

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      window.removeEventListener('message', onMessage)
      if (observer) {
        observer.disconnect()
      }
      router.events.off('routeChangeComplete', schedule)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default RichContentEmbeds
`
}
