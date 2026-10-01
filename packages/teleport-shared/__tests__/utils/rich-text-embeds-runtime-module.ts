import { parse } from '@babel/parser'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { format, resolveConfig } from 'prettier'
import { RichTextEmbeds, RichTextEmbedsCodegen } from '../../src'
import { emitEmbedRuntimeModuleSourceFromFunctions } from '../_helpers/embed-runtime-emitter'

/**
 * The generated project gets `components/embed-runtime.js`, emitted from the
 * very functions in `src/utils/rich-text-embeds.ts` rather than hand-copied
 * into a template. These tests are what makes that safe: the emitted module has
 * to parse, evaluate with no module-scoped references left dangling, and answer
 * exactly what the source module answers.
 */
const SOURCE = RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource()

const COMMITTED_SOURCE_PATH = join(__dirname, '../../src/utils/rich-text-embeds-runtime-source.ts')

/** Rewrites the committed string the generator ships, one source line per array entry. */
const writeCommittedSource = (source: string): void => {
  const lines = source.split('\n').map((line) => `  ${JSON.stringify(line)},`)
  const text = [
    '// GENERATED from src/utils/rich-text-embeds.ts — do not edit by hand. Regenerate with',
    '// UPDATE_EMBED_RUNTIME=1 npx jest packages/teleport-shared/__tests__/utils/rich-text-embeds-runtime-module.ts',
    '// (see generateEmbedRuntimeModuleSource for why this is a string).',
    '/* tslint:disable:no-invalid-template-strings -- the lines are JavaScript source */',
    'export const EMBED_RUNTIME_MODULE_SOURCE = [',
    ...lines,
    "].join('\\n')",
    '',
  ].join('\n')
  const options = resolveConfig.sync(COMMITTED_SOURCE_PATH) || {}
  writeFileSync(COMMITTED_SOURCE_PATH, format(text, { ...options, parser: 'typescript' }))
}

/** Evaluates the ES module source in-process and returns its exports. */
const loadRuntime = (): Record<string, (...args: never[]) => unknown> => {
  const exportedNames = Array.from(
    SOURCE.matchAll(/^export (?:var|function) ([A-Za-z_$][\w$]*)/gm)
  ).map((match) => match[1])
  const body = `${SOURCE.replace(/^export /gm, '')}\nreturn { ${exportedNames.join(', ')} }`
  // eslint-disable-next-line no-new-func
  return new Function(body)() as Record<string, (...args: never[]) => unknown>
}

describe('the emitted embed runtime module', () => {
  it('is the module printed from the source functions', () => {
    const fresh = emitEmbedRuntimeModuleSourceFromFunctions()
    if (process.env.UPDATE_EMBED_RUNTIME) {
      writeCommittedSource(fresh)
      return
    }
    // Fails after a change to rich-text-embeds.ts: regenerate the committed
    // string with UPDATE_EMBED_RUNTIME=1 (command at the top of that file).
    expect(SOURCE).toBe(fresh)
  })

  it('parses as an ES module', () => {
    expect(() => parse(SOURCE, { sourceType: 'module' })).not.toThrow()
  })

  it('carries no reference the module itself does not declare', () => {
    expect(SOURCE).not.toContain('exports.')
    expect(() => loadRuntime()).not.toThrow()
  })

  it('exports every helper the generated editor and activator call', () => {
    const runtime = loadRuntime()
    const required = [
      'isSafeEmbedUrl',
      'resolveEmbedProvider',
      'buildEmbedHtmlFromUrl',
      'resolveEmbedMode',
      'createEmbedValue',
      'buildEmbedElementHtml',
      'buildEmbedFrameChildren',
      'readEmbedValueFromElement',
      'readEncodedEmbedCode',
      'findEmbedFrame',
      'normalizeEmbedsForStorage',
      'resolveEmbedSandboxFlags',
      'buildEmbedSandboxDocument',
      'parseEmbedHeightMessage',
      'createEmbedToken',
      'encodeEmbedCode',
      'decodeEmbedCode',
    ]

    required.forEach((name) => {
      expect(typeof runtime[name]).toBe('function')
    })
  })

  it('answers exactly what the source module answers', () => {
    const runtime = loadRuntime() as unknown as typeof RichTextEmbeds

    const urls = [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://x.com/a/status/1',
      'https://www.figma.com/design/abc/File?node-id=1-2',
      'https://open.spotify.com/track/abc123',
      'https://example.com/plain',
      'javascript:alert(1)',
    ]

    urls.forEach((url) => {
      expect(runtime.isSafeEmbedUrl(url)).toBe(RichTextEmbeds.isSafeEmbedUrl(url))

      const built = runtime.buildEmbedHtmlFromUrl(url)
      const expected = RichTextEmbeds.buildEmbedHtmlFromUrl(url)
      expect(built?.html).toBe(expected?.html)
      expect(built?.provider.id).toBe(expected?.provider.id)

      if (!built || !expected) {
        return
      }

      const params = {
        code: built.html,
        provider: built.provider.id,
        url,
        ratio: built.provider.ratio,
        caption: 'a & "b"',
      }
      expect(runtime.createEmbedValue(params)).toEqual(RichTextEmbeds.createEmbedValue(params))
      expect(runtime.buildEmbedElementHtml(runtime.createEmbedValue(params))).toBe(
        RichTextEmbeds.buildEmbedElementHtml(RichTextEmbeds.createEmbedValue(params))
      )
    })
  })

  it('produces the same sandbox payload as the source module', () => {
    const runtime = loadRuntime() as unknown as typeof RichTextEmbeds

    expect(runtime.resolveEmbedSandboxFlags('strict')).toBe(
      RichTextEmbeds.resolveEmbedSandboxFlags('strict')
    )
    expect(runtime.resolveEmbedSandboxFlags('trusted')).toBe(
      RichTextEmbeds.resolveEmbedSandboxFlags('trusted')
    )
    expect(runtime.buildEmbedSandboxDocument('<b>x</b>', 'tok')).toBe(
      RichTextEmbeds.buildEmbedSandboxDocument('<b>x</b>', 'tok')
    )
    expect(
      runtime.parseEmbedHeightMessage({ type: 'tq-embed-height', token: 'a', height: 9e9 })
    ).toEqual(
      RichTextEmbeds.parseEmbedHeightMessage({ type: 'tq-embed-height', token: 'a', height: 9e9 })
    )
  })

  it('round-trips base64 the same way in both', () => {
    const runtime = loadRuntime() as unknown as typeof RichTextEmbeds
    const code = '<blockquote>café — 日本語 — 🎉</blockquote><script>x()</script>'

    expect(runtime.encodeEmbedCode(code)).toBe(RichTextEmbeds.encodeEmbedCode(code))
    expect(runtime.decodeEmbedCode(RichTextEmbeds.encodeEmbedCode(code))).toBe(code)
  })
})
