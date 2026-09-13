import { parse } from '@babel/parser'
import { RichTextEmbeds, RichTextEmbedsCodegen } from '../../src'

const {
  EMBED_ATTR,
  applyEmbedTemplate,
  buildEmbedElementHtml,
  buildEmbedHtmlFromUrl,
  clampEmbedWidth,
  createEmbedValue,
  decodeEmbedCode,
  embedBlockStyle,
  embedFrameStyle,
  encodeEmbedCode,
  isSafeEmbedUrl,
  normalizeEmbedAlign,
  resolveEmbedMode,
  resolveEmbedProvider,
} = RichTextEmbeds

// The DOM half of the contract (`readEmbedValueFromElement`, the layout and
// caption editors) is covered in teleport-gui, whose test runner has a DOM —
// this repo's jest runs in a node environment.

describe('provider resolution', () => {
  it('matches every YouTube URL spelling to the same embed', () => {
    const urls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ]

    urls.forEach((url) => {
      const built = buildEmbedHtmlFromUrl(url)
      expect(built).not.toBeNull()
      expect(built?.provider.id).toBe('youtube')
      expect(built?.html).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ')
    })
  })

  it('URL-encodes the whole URL where a provider takes it as a query parameter', () => {
    const built = buildEmbedHtmlFromUrl('https://www.figma.com/design/abc123/My-File?node-id=1-2')
    expect(built?.provider.id).toBe('figma')
    expect(built?.html).toContain(
      'url=https%3A%2F%2Fwww.figma.com%2Fdesign%2Fabc123%2FMy-File%3Fnode-id%3D1-2'
    )
  })

  it('falls back to a generic iframe only after every specific provider missed', () => {
    expect(resolveEmbedProvider('https://example.com/some/page')?.provider.id).toBe('iframe-url')
    expect(resolveEmbedProvider('https://vimeo.com/76979871')?.provider.id).toBe('vimeo')
    expect(resolveEmbedProvider('https://codepen.io/team/pen/abcDEF')?.provider.id).toBe('codepen')
  })

  it('refuses anything that is not an http(s) URL', () => {
    expect(isSafeEmbedUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeEmbedUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeEmbedUrl('//evil.example.com')).toBe(false)
    expect(isSafeEmbedUrl('')).toBe(false)
    expect(isSafeEmbedUrl('https://ok.example.com/x')).toBe(true)
    expect(resolveEmbedProvider('javascript:alert(1)')).toBeNull()
  })

  it('keeps `$$` literal and never honours the replacement patterns String.replace reserves', () => {
    const match = 'https://x.test/1'.match(/^https:\/\/x\.test\/(\d+)$/) as RegExpMatchArray
    expect(applyEmbedTemplate("[$1][$$][$'][$`]", match, 'https://x.test/1')).toBe("[1][$][$'][$`]")
  })

  it('gives every provider patterns that agree on their capture groups', () => {
    RichTextEmbeds.EMBED_PROVIDERS.forEach((provider) => {
      const groupCounts = provider.patterns.map(
        (pattern) => new RegExp(`${pattern.source}|`).exec('')?.length ?? 0
      )
      expect(new Set(groupCounts).size).toBe(1)
    })
  })
})

describe('mode resolution', () => {
  it('quarantines anything that can execute', () => {
    expect(resolveEmbedMode('<script src="https://x.test/a.js"></script>')).toBe('sandbox')
    expect(resolveEmbedMode('<img src=x onerror="alert(1)">')).toBe('sandbox')
    expect(resolveEmbedMode('<a href="javascript:alert(1)">x</a>')).toBe('sandbox')
    expect(resolveEmbedMode('<iframe src="https://x.test"></iframe>')).toBe('inline')
  })

  it('does not mistake an attribute merely starting with "on" for a handler', () => {
    expect(resolveEmbedMode('<iframe data-only="1" title="one"></iframe>')).toBe('inline')
  })

  it('sends every script-based provider to the sandbox and the rest inline', () => {
    expect(resolveEmbedMode(buildEmbedHtmlFromUrl('https://x.com/a/status/1')?.html ?? '')).toBe(
      'sandbox'
    )
    expect(
      resolveEmbedMode(buildEmbedHtmlFromUrl('https://youtu.be/dQw4w9WgXcQ')?.html ?? '')
    ).toBe('inline')
  })
})

describe('base64 round-trip', () => {
  it('survives non-ASCII markup', () => {
    const code = '<blockquote>café — 日本語 — 🎉</blockquote>'
    expect(decodeEmbedCode(encodeEmbedCode(code))).toBe(code)
  })
})

describe('stored markup', () => {
  it('keeps an inline embed as real children so it renders without JavaScript', () => {
    const value = createEmbedValue({
      code: '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
      provider: 'youtube',
      url: 'https://youtu.be/abc',
      ratio: 56.25,
      caption: 'A "quoted" caption & more',
    })
    const html = buildEmbedElementHtml(value)

    expect(html).toContain(`${EMBED_ATTR.MODE}="inline"`)
    expect(html).not.toContain(EMBED_ATTR.CODE)
    expect(html).toContain('<iframe src="https://www.youtube.com/embed/abc"></iframe>')
    expect(html).toContain('padding-top:56.25%')
    expect(html).toContain('A &quot;quoted&quot; caption &amp; more')
  })

  it('encodes a script embed and leaves only a noscript fallback in the page', () => {
    const code =
      '<blockquote class="twitter-tweet"></blockquote><script src="https://x.test/w.js"></script>'
    const value = createEmbedValue({ code, provider: 'twitter', url: 'https://x.com/a/status/1' })
    const html = buildEmbedElementHtml(value)

    expect(html).toContain(`${EMBED_ATTR.MODE}="sandbox"`)
    expect(html).toContain(`${EMBED_ATTR.SANDBOX}="strict"`)
    expect(html).toContain(`${EMBED_ATTR.CODE}="${encodeEmbedCode(code)}"`)
    expect(html).not.toContain('<script')
    expect(html).toContain('<noscript>')
  })

  it('omits the noscript fallback for a pasted snippet that has no source URL', () => {
    const html = buildEmbedElementHtml(createEmbedValue({ code: '<script>x()</script>' }))
    expect(html).not.toContain('<noscript>')
    expect(html).toContain(`${EMBED_ATTR.PROVIDER}="custom"`)
  })
})

describe('layout vocabulary', () => {
  it('clamps the width to a usable range', () => {
    expect(clampEmbedWidth(0)).toBe(10)
    expect(clampEmbedWidth(1000)).toBe(100)
    expect(clampEmbedWidth(NaN)).toBe(100)
  })

  it('falls back to center for an unknown alignment', () => {
    expect(normalizeEmbedAlign('diagonal')).toBe('center')
    expect(normalizeEmbedAlign('float-right')).toBe('float-right')
  })

  it('only floats when the alignment asks for it', () => {
    expect(embedBlockStyle({ width: 50, align: 'center' })).toContain('margin-left:auto')
    expect(embedBlockStyle({ width: 50, align: 'center' })).not.toContain('float')
    expect(embedBlockStyle({ width: 50, align: 'float-right' })).toContain('float:right')
  })

  it('only builds a padding-top box for a usable ratio', () => {
    expect(embedFrameStyle(56.25)).toContain('padding-top:56.25%')
    expect(embedFrameStyle(null)).not.toContain('padding-top')
    expect(embedFrameStyle(0)).not.toContain('padding-top')
  })
})

describe('runtime serialization', () => {
  it('emits a registry the generated module can evaluate', () => {
    // tslint:disable-next-line:no-eval
    const providers = eval(RichTextEmbedsCodegen.serializeEmbedProvidersForRuntime()) as Array<{
      id: string
      patterns: RegExp[]
    }>

    expect(providers).toHaveLength(RichTextEmbeds.EMBED_PROVIDERS.length)
    expect(providers[0].patterns[0]).toBeInstanceOf(RegExp)
    expect(providers.map((entry) => entry.id)).toEqual(
      RichTextEmbeds.EMBED_PROVIDERS.map((entry) => entry.id)
    )
  })
})

describe('the sandbox payload', () => {
  const {
    EMBED_MAX_HEIGHT,
    EMBED_MIN_HEIGHT,
    buildEmbedSandboxDocument,
    createEmbedToken,
    parseEmbedHeightMessage,
    resolveEmbedSandboxFlags,
  } = RichTextEmbeds

  it('withholds allow-same-origin unless the author opted in', () => {
    expect(resolveEmbedSandboxFlags('strict')).not.toContain('allow-same-origin')
    expect(resolveEmbedSandboxFlags('trusted')).toContain('allow-same-origin')
  })

  it('hands the frame a bootstrap script that is valid JavaScript', () => {
    // The document is assembled from concatenated fragments, so a stray
    // character would only surface as a silent parse failure inside a sandboxed
    // frame — where nothing can report it. Parse it here instead.
    const doc = buildEmbedSandboxDocument('', 'tok')
    const script = /<script>([\s\S]*?)<\/script>/.exec(doc)

    expect(script).not.toBeNull()
    expect(() => parse((script as RegExpExecArray)[1], { sourceType: 'script' })).not.toThrow()
  })

  it('closes every tag it opens, so the embed lands inside the body', () => {
    const doc = buildEmbedSandboxDocument('<b>x</b>', 'tok')

    expect(doc.indexOf('<body>')).toBeLessThan(doc.indexOf('<b>x</b>'))
    expect(doc.indexOf('<b>x</b>')).toBeLessThan(doc.indexOf('</body>'))
    expect(doc.endsWith('</body></html>')).toBe(true)
  })

  it('bakes the frame token into the document it hands the iframe', () => {
    const token = createEmbedToken()
    const doc = buildEmbedSandboxDocument('<blockquote>hi</blockquote>', token)

    expect(doc).toContain(token)
    expect(doc).not.toContain(RichTextEmbeds.EMBED_TOKEN_PLACEHOLDER)
    expect(doc).toContain('<blockquote>hi</blockquote>')
    expect(doc.indexOf('</head>')).toBeLessThan(doc.indexOf('<blockquote>'))
  })

  it('mints a distinct token per frame', () => {
    expect(createEmbedToken()).not.toBe(createEmbedToken())
  })

  it('accepts only a well-formed height message, and clamps it', () => {
    expect(parseEmbedHeightMessage(null)).toBeNull()
    expect(parseEmbedHeightMessage('tq-embed-height')).toBeNull()
    expect(parseEmbedHeightMessage({ type: 'other', token: 'a', height: 10 })).toBeNull()
    expect(parseEmbedHeightMessage({ type: 'tq-embed-height', token: 1, height: 10 })).toBeNull()
    expect(parseEmbedHeightMessage({ type: 'tq-embed-height', token: 'a', height: 'x' })).toBeNull()
    expect(parseEmbedHeightMessage({ type: 'tq-embed-height', token: 'a', height: -5 })).toBeNull()

    expect(parseEmbedHeightMessage({ type: 'tq-embed-height', token: 'a', height: 1 })).toEqual({
      token: 'a',
      height: EMBED_MIN_HEIGHT,
    })
    expect(parseEmbedHeightMessage({ type: 'tq-embed-height', token: 'a', height: 1e9 })).toEqual({
      token: 'a',
      height: EMBED_MAX_HEIGHT,
    })
  })
})
