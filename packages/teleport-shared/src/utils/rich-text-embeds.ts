/**
 * The "code embed" contract for rich-text CONTENT — the blog post body, and any
 * other column authored through a rich-text editor.
 *
 * A code embed is a block a post author drops into the body to pull in content
 * from another site (a video, a social post, a design frame, a form, or a raw
 * snippet they pasted). It is stored INSIDE the content HTML, so the same shape
 * has to be produced by the studio's Quill editor, produced by the generated
 * admin panel's Quill editor, previewed by the studio canvas and rendered by
 * the exported Next.js app. This module is that single shape.
 *
 * Two rendering modes, decided by one rule (`resolveEmbedMode`):
 *
 *  - `inline`  — the markup is provably passive (no `<script>`, no `on*`
 *                handler, no `javascript:` URL). It is stored as the element's
 *                own children, so it renders server-side, needs no JavaScript
 *                and is crawlable. Most provider embeds are a bare `<iframe>`
 *                and land here.
 *  - `sandbox` — anything else. The markup is base64-encoded into
 *                `data-tq-embed-code` and the runtime materializes it inside a
 *                sandboxed `srcdoc` iframe, so author-supplied JavaScript can
 *                never touch the hosting page. The children hold only a
 *                `<noscript>` link fallback.
 *
 * The provider registry is deliberately DECLARATIVE — patterns plus a
 * replacement template, never functions — so `rich-text-embeds-codegen` can
 * serialize it verbatim into the module the generated project gets, and the
 * editor and the published site can never drift.
 */

export type EmbedAlign = 'center' | 'float-left' | 'float-right'
export type EmbedMode = 'inline' | 'sandbox'
/**
 * `strict` (the default) omits `allow-same-origin`, so the embed runs in an
 * opaque origin and cannot reach the host page's storage or DOM. `trusted` adds
 * it back for the widgets that refuse to render without storage access — an
 * explicit, per-embed opt-in the author has to make.
 */
export type EmbedSandboxLevel = 'strict' | 'trusted'

export interface EmbedValue {
  /** Registry id, or `custom` when the author pasted the markup themselves. */
  provider: string
  /** The source URL, when there was one. Lets the editor re-open the Link tab. */
  url: string
  /** The embed markup itself. */
  code: string
  mode: EmbedMode
  /** Responsive box height as a padding-top percentage; `null` = intrinsic. */
  ratio: number | null
  /** Block width as a percentage of the content column, 10-100. */
  width: number
  align: EmbedAlign
  caption: string
  sandboxLevel: EmbedSandboxLevel
}

export const EMBED_CLASS_NAME = 'tq-embed'
export const EMBED_FRAME_CLASS_NAME = 'tq-embed-frame'
export const EMBED_CAPTION_CLASS_NAME = 'tq-embed-caption'

/** The Quill blot name, shared by the studio editor and the generated one. */
export const EMBED_BLOT_NAME = 'tq-embed'

export const EMBED_ATTR = {
  MARKER: 'data-tq-embed',
  PROVIDER: 'data-tq-embed-provider',
  URL: 'data-tq-embed-url',
  MODE: 'data-tq-embed-mode',
  CODE: 'data-tq-embed-code',
  RATIO: 'data-tq-embed-ratio',
  WIDTH: 'data-tq-embed-width',
  ALIGN: 'data-tq-embed-align',
  CAPTION: 'data-tq-embed-caption',
  SANDBOX: 'data-tq-embed-sandbox',
  /** Written by a runtime once a sandbox embed has been mounted. */
  ACTIVATED: 'data-tq-embed-activated',
  /**
   * Marks an element an EDITOR added purely to preview the embed. Editors read
   * their value back out of the live DOM, so a preview must be recognizable in
   * order to be stripped again — see `normalizeEmbedsForStorage`.
   */
  PREVIEW: 'data-tq-embed-preview',
} as const

export const EMBED_ALIGNMENTS: EmbedAlign[] = ['center', 'float-left', 'float-right']

export const CUSTOM_EMBED_PROVIDER_ID = 'custom'
export const GENERIC_EMBED_PROVIDER_ID = 'iframe-url'

export const DEFAULT_EMBED_WIDTH = 100
export const DEFAULT_EMBED_ALIGN: EmbedAlign = 'center'
export const DEFAULT_EMBED_SANDBOX_LEVEL: EmbedSandboxLevel = 'strict'
/** 16:9, as a padding-top percentage. */
export const WIDESCREEN_EMBED_RATIO = 56.25

export interface EmbedProviderDefinition {
  id: string
  label: string
  /**
   * Alternative spellings of the same URL. Every pattern of one provider must
   * expose the same capture groups, because `template` indexes them by number.
   */
  patterns: RegExp[]
  /**
   * The markup, with `$1`-`$9` replaced by the capture groups and `$&` by the
   * whole URL. Prefix the token with `E` (`$E1`, `$E&`) to URL-encode it.
   * A literal dollar is written `$$`.
   */
  template: string
  /**
   * When set, the frame becomes a responsive padding-top box of this
   * percentage and the template's iframe is expected to fill it absolutely.
   * `null` means the template carries its own height.
   */
  ratio: number | null
}

const FILL_FRAME_STYLE =
  'position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:inherit'
const BLOCK_FRAME_STYLE = 'display:block;width:100%;border:0;border-radius:inherit'

const iframeTemplate = (
  src: string,
  options: { title: string; fill: boolean; height?: number }
) => {
  const style = options.fill
    ? FILL_FRAME_STYLE
    : `${BLOCK_FRAME_STYLE};height:${options.height ?? 400}px`
  return (
    `<iframe src="${src}" title="${options.title}" loading="lazy" frameborder="0" ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share" ` +
    `allowfullscreen style="${style}"></iframe>`
  )
}

/**
 * Ordered most-specific first: `resolveEmbedProvider` returns the first match,
 * and the generic `iframe-url` fallback is deliberately last.
 */
export const EMBED_PROVIDERS: EmbedProviderDefinition[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    patterns: [
      /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,})/i,
      /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,})/i,
      /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/i,
      /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/i,
    ],
    template: iframeTemplate('https://www.youtube.com/embed/$1', {
      title: 'YouTube video',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'vimeo',
    label: 'Vimeo',
    patterns: [
      /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i,
      /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i,
    ],
    template: iframeTemplate('https://player.vimeo.com/video/$1', {
      title: 'Vimeo video',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'loom',
    label: 'Loom',
    patterns: [/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/i],
    template: iframeTemplate('https://www.loom.com/embed/$1', {
      title: 'Loom video',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'dailymotion',
    label: 'Dailymotion',
    patterns: [
      /^https?:\/\/(?:www\.)?dailymotion\.com\/video\/([A-Za-z0-9]+)/i,
      /^https?:\/\/dai\.ly\/([A-Za-z0-9]+)/i,
    ],
    template: iframeTemplate('https://www.dailymotion.com/embed/video/$1', {
      title: 'Dailymotion video',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'spotify',
    label: 'Spotify',
    patterns: [
      /^https?:\/\/open\.spotify\.com\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/i,
    ],
    template: iframeTemplate('https://open.spotify.com/embed/$1/$2', {
      title: 'Spotify player',
      fill: false,
      height: 352,
    }),
    ratio: null,
  },
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    patterns: [/^https?:\/\/soundcloud\.com\/[^?#]+/i],
    template: iframeTemplate(
      'https://w.soundcloud.com/player/?url=$E&&color=%23ff5500&auto_play=false&show_teaser=false',
      { title: 'SoundCloud player', fill: false, height: 166 }
    ),
    ratio: null,
  },
  {
    id: 'apple-podcasts',
    label: 'Apple Podcasts',
    patterns: [/^https?:\/\/podcasts\.apple\.com\/(.+)$/i],
    template: iframeTemplate('https://embed.podcasts.apple.com/$1', {
      title: 'Apple Podcasts player',
      fill: false,
      height: 175,
    }),
    ratio: null,
  },
  {
    id: 'twitter',
    label: 'X (Twitter)',
    patterns: [/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i],
    template:
      '<blockquote class="twitter-tweet"><a href="$&"></a></blockquote>' +
      '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>',
    ratio: null,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    patterns: [/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i],
    template:
      '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/$1/" data-instgrm-version="14"></blockquote>' +
      '<script async src="https://www.instagram.com/embed.js"></script>',
    ratio: null,
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    patterns: [/^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/(\d+)/i],
    template:
      '<blockquote class="tiktok-embed" cite="$&" data-video-id="$1"><section></section></blockquote>' +
      '<script async src="https://www.tiktok.com/embed.js"></script>',
    ratio: null,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    patterns: [/^https?:\/\/(?:www\.)?reddit\.com\/r\/[^/]+\/comments\/.+/i],
    template:
      '<blockquote class="reddit-embed-bq"><a href="$&"></a></blockquote>' +
      '<script async src="https://embed.reddit.com/widgets.js" charset="UTF-8"></script>',
    ratio: null,
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    patterns: [/^https?:\/\/(?:[a-z]{2}\.)?pinterest\.[a-z.]+\/pin\/[0-9]+/i],
    template:
      '<a data-pin-do="embedPin" href="$&"></a>' +
      '<script async defer src="https://assets.pinterest.com/js/pinit.js"></script>',
    ratio: null,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    patterns: [/^https?:\/\/(?:www\.|web\.)?facebook\.com\/.+\/(?:posts|videos)\/.+/i],
    template: iframeTemplate('https://www.facebook.com/plugins/post.php?href=$E&&show_text=true', {
      title: 'Facebook post',
      fill: false,
      height: 500,
    }),
    ratio: null,
  },
  {
    id: 'github-gist',
    label: 'GitHub Gist',
    patterns: [/^https?:\/\/gist\.github\.com\/([^/]+\/[a-f0-9]+)/i],
    template: '<script src="https://gist.github.com/$1.js"></script>',
    ratio: null,
  },
  {
    id: 'codepen',
    label: 'CodePen',
    patterns: [/^https?:\/\/codepen\.io\/([^/]+)\/(?:pen|embed|details|full)\/([A-Za-z0-9]+)/i],
    template: iframeTemplate('https://codepen.io/$1/embed/$2?default-tab=result', {
      title: 'CodePen',
      fill: false,
      height: 400,
    }),
    ratio: null,
  },
  {
    id: 'codesandbox',
    label: 'CodeSandbox',
    patterns: [
      /^https?:\/\/codesandbox\.io\/(?:s|embed)\/([A-Za-z0-9_-]+)/i,
      /^https?:\/\/codesandbox\.io\/p\/(?:sandbox|devbox)\/([A-Za-z0-9_-]+)/i,
    ],
    template: iframeTemplate('https://codesandbox.io/embed/$1', {
      title: 'CodeSandbox',
      fill: false,
      height: 500,
    }),
    ratio: null,
  },
  {
    id: 'jsfiddle',
    label: 'JSFiddle',
    patterns: [/^https?:\/\/(?:www\.)?jsfiddle\.net\/((?:[^/]+\/)?[A-Za-z0-9]+)\/?/i],
    template: iframeTemplate('https://jsfiddle.net/$1/embedded/', {
      title: 'JSFiddle',
      fill: false,
      height: 400,
    }),
    ratio: null,
  },
  {
    id: 'figma',
    label: 'Figma',
    patterns: [/^https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board|slides)\/.+/i],
    template: iframeTemplate('https://www.figma.com/embed?embed_host=share&url=$E&', {
      title: 'Figma',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'canva',
    label: 'Canva',
    patterns: [
      /^https?:\/\/(?:www\.)?canva\.com\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(?:view|watch)/i,
    ],
    template: iframeTemplate('https://www.canva.com/design/$1/$2/view?embed', {
      title: 'Canva design',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'miro',
    label: 'Miro',
    patterns: [/^https?:\/\/miro\.com\/app\/(?:board|live-embed)\/([A-Za-z0-9_=-]+)/i],
    template: iframeTemplate('https://miro.com/app/live-embed/$1/', {
      title: 'Miro board',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'google-maps',
    label: 'Google Maps',
    patterns: [/^https?:\/\/(?:www\.)?google\.[a-z.]+\/maps\/embed\?(.+)$/i],
    template: iframeTemplate('https://www.google.com/maps/embed?$1', {
      title: 'Google Maps',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'google-maps-place',
    label: 'Google Maps',
    patterns: [/^https?:\/\/(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.app\.goo\.gl)\/.+/i],
    template: iframeTemplate('https://maps.google.com/maps?q=$E&&output=embed', {
      title: 'Google Maps',
      fill: true,
    }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
  {
    id: 'google-forms',
    label: 'Google Forms',
    patterns: [/^https?:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]+)/i],
    template: iframeTemplate('https://docs.google.com/forms/d/e/$1/viewform?embedded=true', {
      title: 'Google Form',
      fill: false,
      height: 700,
    }),
    ratio: null,
  },
  {
    id: 'google-docs',
    label: 'Google Docs',
    patterns: [
      /^https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/i,
    ],
    template: iframeTemplate('https://docs.google.com/$1/d/$2/preview', {
      title: 'Google Docs',
      fill: false,
      height: 600,
    }),
    ratio: null,
  },
  {
    id: 'airtable',
    label: 'Airtable',
    patterns: [/^https?:\/\/airtable\.com\/(?:embed\/)?(app[A-Za-z0-9/?=&_-]+)/i],
    template: iframeTemplate('https://airtable.com/embed/$1', {
      title: 'Airtable',
      fill: false,
      height: 533,
    }),
    ratio: null,
  },
  {
    id: 'typeform',
    label: 'Typeform',
    patterns: [/^https?:\/\/(?:[A-Za-z0-9-]+\.)?typeform\.com\/to\/([A-Za-z0-9]+)/i],
    template: iframeTemplate('https://form.typeform.com/to/$1', {
      title: 'Typeform',
      fill: false,
      height: 500,
    }),
    ratio: null,
  },
  {
    id: 'calendly',
    label: 'Calendly',
    patterns: [/^https?:\/\/calendly\.com\/(.+)$/i],
    template: iframeTemplate('https://calendly.com/$1', {
      title: 'Calendly',
      fill: false,
      height: 700,
    }),
    ratio: null,
  },
  {
    id: GENERIC_EMBED_PROVIDER_ID,
    label: 'Web page',
    patterns: [/^https:\/\/[^\s"'<>]+$/i],
    template: iframeTemplate('$&', { title: 'Embedded page', fill: true }),
    ratio: WIDESCREEN_EMBED_RATIO,
  },
]

export interface EmbedProviderMatch {
  provider: EmbedProviderDefinition
  match: RegExpMatchArray
}

/** `javascript:`, `data:` and protocol-relative URLs never become an embed. */
export function isSafeEmbedUrl(url: string): boolean {
  return /^https?:\/\/[^\s"'<>]+$/i.test((url || '').trim())
}

/** How an embed names itself in the editor: the provider, or "Custom code". */
export function embedProviderLabel(providerId: string): string {
  const provider = EMBED_PROVIDERS.filter((entry) => entry.id === providerId)[0]
  return provider ? provider.label : 'Custom code'
}

export function resolveEmbedProvider(url: string): EmbedProviderMatch | null {
  const trimmed = (url || '').trim()
  if (!isSafeEmbedUrl(trimmed)) {
    return null
  }

  for (const provider of EMBED_PROVIDERS) {
    for (const pattern of provider.patterns) {
      const match = trimmed.match(pattern)
      if (match) {
        return { provider, match }
      }
    }
  }
  return null
}

/**
 * Substitutes `$1`-`$9` / `$E1`-`$E9` / `$&` / `$E&` in a provider template.
 * Written by hand rather than through `String.replace` so the replacement
 * patterns `String.replace` reserves (`$'`, "$`", `$<name>`) stay literal.
 */
export function applyEmbedTemplate(template: string, match: RegExpMatchArray, url: string): string {
  return template.replace(/\$(\$|E?(?:[1-9]|&))/g, (_token, spec: string) => {
    if (spec === '$') {
      return '$'
    }
    const encoded = spec.charAt(0) === 'E'
    const key = encoded ? spec.slice(1) : spec
    const raw = key === '&' ? url : match[Number(key)] ?? ''
    return encoded ? encodeURIComponent(raw) : raw
  })
}

/** The embed markup for a pasted URL, or `null` when nothing recognizes it. */
export function buildEmbedHtmlFromUrl(url: string): {
  provider: EmbedProviderDefinition
  html: string
} | null {
  const resolved = resolveEmbedProvider(url)
  if (!resolved) {
    return null
  }
  return {
    provider: resolved.provider,
    html: applyEmbedTemplate(resolved.provider.template, resolved.match, url.trim()),
  }
}

/**
 * Markup that can execute anything — a `<script>`, an inline `on*` handler or a
 * `javascript:` URL — is quarantined in a sandboxed iframe. Everything else is
 * passive and can be rendered straight into the page.
 */
export function resolveEmbedMode(html: string): EmbedMode {
  const markup = html || ''
  const executes =
    /<script[\s/>]/i.test(markup) ||
    /\son[a-z]+\s*=/i.test(markup) ||
    /(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i.test(markup)
  return executes ? 'sandbox' : 'inline'
}

export function clampEmbedWidth(width: number): number {
  if (!isFinite(width)) {
    return DEFAULT_EMBED_WIDTH
  }
  return Math.max(10, Math.min(100, Math.round(width)))
}

export function normalizeEmbedAlign(align: string): EmbedAlign {
  return (EMBED_ALIGNMENTS as string[]).indexOf(align) !== -1
    ? (align as EmbedAlign)
    : DEFAULT_EMBED_ALIGN
}

export function escapeEmbedAttribute(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function escapeEmbedText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * UTF-8 safe base64, working in both the browser (`btoa`) and Node (`Buffer`).
 * The intermediate `%xx` round-trip is what makes non-ASCII captions and
 * markup survive — `btoa` alone throws on anything above U+00FF.
 */
export function encodeEmbedCode(code: string): string {
  const binary = encodeURIComponent(code).replace(/%([0-9A-F]{2})/gi, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  )
  if (typeof btoa === 'function') {
    return btoa(binary)
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(binary, 'binary').toString('base64')
  }
  throw new Error('No base64 encoder available')
}

export function decodeEmbedCode(encoded: string): string {
  let binary: string
  if (typeof atob === 'function') {
    binary = atob(encoded)
  } else if (typeof Buffer !== 'undefined') {
    binary = Buffer.from(encoded, 'base64').toString('binary')
  } else {
    throw new Error('No base64 decoder available')
  }
  let percent = ''
  for (let index = 0; index < binary.length; index += 1) {
    percent += `%${`00${binary.charCodeAt(index).toString(16)}`.slice(-2)}`
  }
  return decodeURIComponent(percent)
}

export function createEmbedValue(params: {
  code: string
  provider?: string
  url?: string
  ratio?: number | null
  width?: number
  align?: string
  caption?: string
  sandboxLevel?: EmbedSandboxLevel
}): EmbedValue {
  const code = params.code || ''
  return {
    provider: params.provider || CUSTOM_EMBED_PROVIDER_ID,
    url: params.url || '',
    code,
    mode: resolveEmbedMode(code),
    ratio: params.ratio ?? null,
    width: clampEmbedWidth(params.width ?? DEFAULT_EMBED_WIDTH),
    align: normalizeEmbedAlign(params.align ?? DEFAULT_EMBED_ALIGN),
    caption: params.caption || '',
    sandboxLevel: params.sandboxLevel === 'trusted' ? 'trusted' : DEFAULT_EMBED_SANDBOX_LEVEL,
  }
}

/**
 * The outer block's own layout — width, float and the margins each align needs.
 *
 * `position:relative` is deliberate: an editor overlays a click catcher on the
 * block (an embed's own iframe swallows the click that should select it), and
 * that overlay needs the block as its positioning context.
 */
export function embedBlockStyle(value: Pick<EmbedValue, 'width' | 'align'>): string {
  const declarations = [
    'position:relative',
    `width:${clampEmbedWidth(value.width)}%`,
    'max-width:100%',
    'margin:16px 0',
  ]
  if (value.align === 'center') {
    declarations.push('margin-left:auto', 'margin-right:auto')
  } else if (value.align === 'float-left') {
    declarations.push('float:left', 'margin-right:16px', 'margin-bottom:8px')
  } else if (value.align === 'float-right') {
    declarations.push('float:right', 'margin-left:16px', 'margin-bottom:8px')
  }
  return declarations.join(';')
}

/**
 * The frame is what holds the embed itself. With a `ratio` it becomes the
 * responsive padding-top box the provider templates fill absolutely; without
 * one the template carries its own height.
 */
export function embedFrameStyle(ratio: number | null): string {
  if (ratio === null || !isFinite(ratio) || ratio <= 0) {
    return 'position:relative;width:100%'
  }
  return `position:relative;width:100%;padding-top:${ratio}%`
}

export const EMBED_CAPTION_STYLE =
  'margin-top:8px;font-size:0.875em;line-height:1.5;opacity:0.75;text-align:center'

/**
 * The stored markup for one embed. This is the exact string both editors write
 * into the content column and both runtimes read back.
 */
export function buildEmbedElementHtml(value: EmbedValue): string {
  const attrs = [
    `class="${EMBED_CLASS_NAME}"`,
    `${EMBED_ATTR.MARKER}="1"`,
    `${EMBED_ATTR.PROVIDER}="${escapeEmbedAttribute(value.provider)}"`,
    `${EMBED_ATTR.MODE}="${value.mode}"`,
    `${EMBED_ATTR.WIDTH}="${clampEmbedWidth(value.width)}"`,
    `${EMBED_ATTR.ALIGN}="${value.align}"`,
    `${EMBED_ATTR.SANDBOX}="${value.sandboxLevel}"`,
  ]
  if (value.url) {
    attrs.push(`${EMBED_ATTR.URL}="${escapeEmbedAttribute(value.url)}"`)
  }
  if (value.ratio !== null) {
    attrs.push(`${EMBED_ATTR.RATIO}="${value.ratio}"`)
  }
  if (value.caption) {
    attrs.push(`${EMBED_ATTR.CAPTION}="${escapeEmbedAttribute(value.caption)}"`)
  }
  if (value.mode === 'sandbox') {
    attrs.push(`${EMBED_ATTR.CODE}="${escapeEmbedAttribute(encodeEmbedCode(value.code))}"`)
  }
  attrs.push('contenteditable="false"')
  attrs.push(`style="${embedBlockStyle(value)}"`)

  const caption = value.caption
    ? `<figcaption class="${EMBED_CAPTION_CLASS_NAME}" style="${EMBED_CAPTION_STYLE}">${escapeEmbedText(
        value.caption
      )}</figcaption>`
    : ''

  return (
    `<figure ${attrs.join(' ')}>` +
    `<div class="${EMBED_FRAME_CLASS_NAME}" style="${embedFrameStyle(value.ratio)}">` +
    `${buildEmbedFrameChildren(value)}</div>${caption}</figure>`
  )
}

/**
 * `inline` keeps the markup as real children so it renders with no JavaScript.
 * `sandbox` keeps only a `<noscript>` link — the markup itself lives, encoded,
 * on `data-tq-embed-code` and the runtime mounts it in a sandboxed iframe.
 */
export function buildEmbedFrameChildren(value: EmbedValue): string {
  if (value.mode === 'inline') {
    return value.code
  }
  if (!value.url) {
    return ''
  }
  return (
    `<noscript><a href="${escapeEmbedAttribute(value.url)}" rel="noopener noreferrer" ` +
    `target="_blank">${escapeEmbedText(value.url)}</a></noscript>`
  )
}

/* ── Reading a stored embed back out of the DOM ─────────────────────────────
 *
 * Used by the studio blot (`static value(node)`), by the selection overlay and
 * by the runtime activator. The frame element is the single place the markup
 * lives, so both directions agree on where to look.
 */

export function findEmbedFrame(element: Element): Element | null {
  return element.querySelector(`.${EMBED_FRAME_CLASS_NAME}`)
}

export function readEmbedValueFromElement(element: Element): EmbedValue {
  const mode: EmbedMode = element.getAttribute(EMBED_ATTR.MODE) === 'sandbox' ? 'sandbox' : 'inline'
  const frame = findEmbedFrame(element)
  const rawRatio = element.getAttribute(EMBED_ATTR.RATIO)
  const parsedRatio = rawRatio === null ? NaN : parseFloat(rawRatio)

  let code = ''
  if (mode === 'sandbox') {
    code = readEncodedEmbedCode(element)
  } else if (frame) {
    code = frame.innerHTML
  }

  return {
    provider: element.getAttribute(EMBED_ATTR.PROVIDER) || CUSTOM_EMBED_PROVIDER_ID,
    url: element.getAttribute(EMBED_ATTR.URL) || '',
    code,
    mode,
    ratio: isFinite(parsedRatio) ? parsedRatio : null,
    width: clampEmbedWidth(parseFloat(element.getAttribute(EMBED_ATTR.WIDTH) || '')),
    align: normalizeEmbedAlign(element.getAttribute(EMBED_ATTR.ALIGN) || ''),
    caption: element.getAttribute(EMBED_ATTR.CAPTION) || '',
    sandboxLevel:
      element.getAttribute(EMBED_ATTR.SANDBOX) === 'trusted'
        ? 'trusted'
        : DEFAULT_EMBED_SANDBOX_LEVEL,
  }
}

/**
 * A corrupted `data-tq-embed-code` (truncated by an export round-trip, mangled
 * by a content rewrite) must degrade to "render nothing", never to a thrown
 * exception inside a render pass.
 */
export function readEncodedEmbedCode(element: Element): string {
  const encoded = element.getAttribute(EMBED_ATTR.CODE)
  if (!encoded) {
    return ''
  }
  try {
    return decodeEmbedCode(encoded)
  } catch {
    return ''
  }
}

/** Writes one `style` declaration block, replacing whatever was there. */
function writeStyle(element: Element, style: string): void {
  element.setAttribute('style', style)
}

export function applyEmbedElementLayout(
  element: Element,
  updates: { width?: number; align?: string }
): void {
  if (updates.width !== undefined) {
    element.setAttribute(EMBED_ATTR.WIDTH, String(clampEmbedWidth(updates.width)))
  }
  if (updates.align !== undefined) {
    element.setAttribute(EMBED_ATTR.ALIGN, normalizeEmbedAlign(updates.align))
  }
  writeStyle(
    element,
    embedBlockStyle({
      width: clampEmbedWidth(parseFloat(element.getAttribute(EMBED_ATTR.WIDTH) || '')),
      align: normalizeEmbedAlign(element.getAttribute(EMBED_ATTR.ALIGN) || ''),
    })
  )
}

/**
 * Adds, updates or removes the caption element in place. The caption lives both
 * as an attribute (so it survives a sandbox re-render) and as visible text.
 */
export function applyEmbedElementCaption(element: Element, caption: string): void {
  const trimmed = caption || ''
  let node = element.querySelector(`.${EMBED_CAPTION_CLASS_NAME}`)

  if (!trimmed) {
    element.removeAttribute(EMBED_ATTR.CAPTION)
    if (node && node.parentNode) {
      node.parentNode.removeChild(node)
    }
    return
  }

  element.setAttribute(EMBED_ATTR.CAPTION, trimmed)
  if (!node) {
    node = element.ownerDocument.createElement('figcaption')
    node.setAttribute('class', EMBED_CAPTION_CLASS_NAME)
    writeStyle(node, EMBED_CAPTION_STYLE)
    element.appendChild(node)
  }
  node.textContent = trimmed
}

/* ── The sandbox payload ────────────────────────────────────────────────────
 *
 * Three surfaces mount a sandboxed embed: the studio's Quill editor preview,
 * the studio canvas (Solid) and the exported Next.js app (React). The WIRING
 * has to differ — each framework owns its own effect and cleanup — but the
 * payload must not, or an embed would behave differently depending on where it
 * is looked at. Everything that decides behaviour lives here as data: the
 * sandbox flags, the document the iframe is given, the height protocol and its
 * bounds. Each surface only concatenates and mounts.
 */

/**
 * `allow-same-origin` is deliberately absent: combined with `allow-scripts` it
 * lets a frame reach into the host page and even remove its own sandbox, which
 * is the whole thing this mode exists to prevent.
 */
export const EMBED_SANDBOX_FLAGS_STRICT =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation'

/** The opt-in for widgets that refuse to render without storage access. */
export const EMBED_SANDBOX_FLAGS_TRUSTED = `${EMBED_SANDBOX_FLAGS_STRICT} allow-same-origin`

export function resolveEmbedSandboxFlags(level: EmbedSandboxLevel): string {
  return level === 'trusted' ? EMBED_SANDBOX_FLAGS_TRUSTED : EMBED_SANDBOX_FLAGS_STRICT
}

export const EMBED_HEIGHT_MESSAGE_TYPE = 'tq-embed-height'
export const EMBED_TOKEN_PLACEHOLDER = '__TQ_EMBED_TOKEN__'
export const EMBED_MIN_HEIGHT = 80
export const EMBED_MAX_HEIGHT = 6000
/** Until the frame reports back, this is what it occupies. */
export const EMBED_INITIAL_HEIGHT = 320

export const EMBED_SANDBOX_DOC_HEAD =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<base target="_blank">' +
  '<style>html,body{margin:0;padding:0;background:transparent}' +
  'img,iframe,video,blockquote{max-width:100%}</style>' +
  '<script>(function(){' +
  `var token=${JSON.stringify(EMBED_TOKEN_PLACEHOLDER)};` +
  'var last=0;' +
  'function report(){try{' +
  'var doc=document.documentElement;var body=document.body;' +
  'var height=Math.max(doc?doc.scrollHeight:0,doc?doc.offsetHeight:0,' +
  'body?body.scrollHeight:0,body?body.offsetHeight:0);' +
  'if(!height||height===last){return;}last=height;' +
  `parent.postMessage({type:${JSON.stringify(
    EMBED_HEIGHT_MESSAGE_TYPE
  )},token:token,height:height},"*");` +
  '}catch(e){}}' +
  'function watch(){report();' +
  'if(typeof ResizeObserver==="function"&&document.documentElement){' +
  'new ResizeObserver(report).observe(document.documentElement);}' +
  'if(typeof MutationObserver==="function"&&document.body){' +
  'new MutationObserver(report).observe(document.body,' +
  '{childList:true,subtree:true,attributes:true});}' +
  // Several providers paint well after `load` (they fetch, then swap in their
  // own iframe), so a few late reports are what stops a widget from sitting in
  // a box sized for its placeholder.
  'var delays=[150,400,900,1800,3500];' +
  'for(var i=0;i<delays.length;i++){setTimeout(report,delays[i]);}}' +
  'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",watch);}' +
  'else{watch();}window.addEventListener("load",report);' +
  '})();</script></head><body>'

export const EMBED_SANDBOX_DOC_TAIL = '</body></html>'

/**
 * The document a sandboxed embed is given. Assign it to `iframe.srcdoc` as a
 * property — writing it into the attribute would need HTML escaping.
 */
export function buildEmbedSandboxDocument(code: string, token: string): string {
  return (
    EMBED_SANDBOX_DOC_HEAD.replace(EMBED_TOKEN_PLACEHOLDER, token) +
    (code || '') +
    EMBED_SANDBOX_DOC_TAIL
  )
}

/**
 * A sandboxed frame has an opaque origin, so `event.origin` is `"null"` and
 * cannot identify it. The per-frame token baked into its document is the guard
 * instead: a message is only ever matched against tokens this page minted.
 */
export function parseEmbedHeightMessage(data: unknown): { token: string; height: number } | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const message = data as { type?: unknown; token?: unknown; height?: unknown }
  if (message.type !== EMBED_HEIGHT_MESSAGE_TYPE || typeof message.token !== 'string') {
    return null
  }
  const height = Number(message.height)
  if (!isFinite(height) || height <= 0) {
    return null
  }
  return {
    token: message.token,
    height: Math.min(Math.max(Math.round(height), EMBED_MIN_HEIGHT), EMBED_MAX_HEIGHT),
  }
}

let embedTokenCounter = 0

export function createEmbedToken(): string {
  embedTokenCounter += 1
  return `tqe-${Date.now().toString(36)}-${embedTokenCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/**
 * Restores every embed inside `root` to its canonical STORED form, in place.
 *
 * An editor reads its value back out of the live DOM (Quill hands back
 * `root.innerHTML`), and by then the DOM carries things the content column must
 * never keep: the preview an editor mounted next to a sandboxed embed, and the
 * marker a runtime writes once it has handled a block. The editor normalizes a
 * detached CLONE of its root through this before emitting a value, so what is
 * stored is exactly what `buildEmbedElementHtml` would have produced — whatever
 * the preview did to the live DOM.
 *
 * The frame restore is a self-heal for the other mounting strategy: the canvas
 * and the published page mount INTO the frame, because they never read back.
 */
export function normalizeEmbedsForStorage(root: Element): void {
  const previews = root.querySelectorAll(`[${EMBED_ATTR.PREVIEW}]`)
  for (let index = previews.length - 1; index >= 0; index -= 1) {
    const preview = previews[index]
    if (preview.parentNode) {
      preview.parentNode.removeChild(preview)
    }
  }

  const blocks = root.querySelectorAll(`[${EMBED_ATTR.MARKER}]`)
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    block.removeAttribute(EMBED_ATTR.ACTIVATED)

    const frame = findEmbedFrame(block)
    if (!frame) {
      continue
    }
    const value = readEmbedValueFromElement(block)
    if (value.mode !== 'sandbox') {
      continue
    }
    frame.innerHTML = buildEmbedFrameChildren(value)
  }
}
