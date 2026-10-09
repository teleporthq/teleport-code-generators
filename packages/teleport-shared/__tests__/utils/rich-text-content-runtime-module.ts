import { parse } from '@babel/parser'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { format, resolveConfig } from 'prettier'
import { RichTextContentCodegen } from '../../src'
import { emitRichTextContentRuntimeModuleSourceFromFunctions } from '../_helpers/rich-text-content-runtime-emitter'

/**
 * The generated project gets `components/rich-text-content.js`, emitted from
 * the very functions in `src/utils/rich-text-content.ts`. These tests keep that
 * safe: the committed string is the one printed from the source, it parses as
 * a module, and it evaluates with nothing left dangling.
 */
const SOURCE = RichTextContentCodegen.generateRichTextContentRuntimeModuleSource()

const COMMITTED_SOURCE_PATH = join(__dirname, '../../src/utils/rich-text-content-runtime-source.ts')

const writeCommittedSource = (source: string): void => {
  const lines = source.split('\n').map((line) => `  ${JSON.stringify(line)},`)
  const text = [
    '// GENERATED from src/utils/rich-text-content.ts — do not edit by hand. Regenerate with',
    '// UPDATE_RICH_TEXT_CONTENT_RUNTIME=1 npx jest packages/teleport-shared/__tests__/utils/rich-text-content-runtime-module.ts',
    '// (see generateRichTextContentRuntimeModuleSource for why this is a string).',
    '/* tslint:disable:no-invalid-template-strings -- the lines are JavaScript source */',
    'export const RICH_TEXT_CONTENT_RUNTIME_MODULE_SOURCE = [',
    ...lines,
    "].join('\\n')",
    '',
  ].join('\n')
  const options = resolveConfig.sync(COMMITTED_SOURCE_PATH) || {}
  writeFileSync(COMMITTED_SOURCE_PATH, format(text, { ...options, parser: 'typescript' }))
}

const loadRuntime = (): Record<string, (...args: never[]) => unknown> => {
  const exportedNames = Array.from(
    SOURCE.matchAll(/^export (?:var|function) ([A-Za-z_$][\w$]*)/gm)
  ).map((match) => match[1])
  const body = `${SOURCE.replace(/^export /gm, '')}\nreturn { ${exportedNames.join(', ')} }`
  // eslint-disable-next-line no-new-func
  return new Function(body)() as Record<string, (...args: never[]) => unknown>
}

describe('the emitted rich-text content module', () => {
  it('is the module printed from the source functions', () => {
    const fresh = emitRichTextContentRuntimeModuleSourceFromFunctions()
    if (process.env.UPDATE_RICH_TEXT_CONTENT_RUNTIME) {
      writeCommittedSource(fresh)
      return
    }
    // Fails after a change to rich-text-content.ts: regenerate the committed
    // string with UPDATE_RICH_TEXT_CONTENT_RUNTIME=1 (command at the top of that file).
    expect(SOURCE).toBe(fresh)
  })

  it('parses as an ES module', () => {
    expect(() => parse(SOURCE, { sourceType: 'module' })).not.toThrow()
  })

  it('carries no reference the module itself does not declare', () => {
    expect(SOURCE).not.toContain('exports.')
    expect(() => loadRuntime()).not.toThrow()
  })

  it('answers the string-only questions exactly as the source module does', () => {
    const runtime = loadRuntime()
    const studio =
      '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>one</li>' +
      '<li data-list="ordered" class="ql-indent-1"><span class="ql-ui" contenteditable="false"></span>two</li></ol>'
    expect(runtime.normalizeLegacyRichTextHtml(studio as never)).toBe(
      '<ul><li>one<ol><li>two</li></ol></li></ul>'
    )
    expect(runtime.buildCodeBlockHtml('js' as never, 'a < b' as never)).toBe(
      '<pre><code class="language-js">a &lt; b</code></pre>'
    )
    expect(runtime.buildProtectedBlockHtml('table' as never, '<table></table>' as never)).toBe(
      '<div class="tq-protected" data-tq-protected="table" contenteditable="false"><table></table></div>'
    )
  })

  it('exports every helper the generated editor imports', () => {
    const runtime = loadRuntime()
    ;[
      'PROTECTED_BLOCK_BLOT_NAME',
      'PROTECTED_BLOCK_CLASS',
      'buildProtectedBlockHtml',
      'readProtectedBlockValue',
      'toEditorHtml',
      'fromEditorHtml',
    ].forEach((name) => {
      expect(runtime[name]).toBeDefined()
    })
  })
})

describe('the render-time normalizer cut for the data modules', () => {
  const code = RichTextContentCodegen.generateLegacyRichTextNormalizerCode()

  it('is plain declarations that evaluate on their own, without a DOM', () => {
    expect(code).not.toContain('export ')
    expect(code).not.toContain('DOMParser')
    // eslint-disable-next-line no-new-func
    const normalize = new Function(`${code}\nreturn normalizeLegacyRichTextHtml`)() as (
      html: string
    ) => string
    expect(
      normalize(
        '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>one</li></ol><p>a&nbsp;b</p>'
      )
    ).toBe('<ul><li>one</li></ul><p>a b</p>')
  })

  it('parses as a script', () => {
    expect(() => parse(code, { sourceType: 'script' })).not.toThrow()
  })
})
