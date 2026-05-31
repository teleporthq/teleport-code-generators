import { nodeRegistry } from '../src'

// PERMANENT guard against a class of corruption that has bitten generated
// projects: workflow node handlers are shipped into the user's project as
// RUNTIME SOURCE (the `.toString()` of a compiled function returned by
// `generateHandler()` / `generateServerHandler()`). That source is then run
// through the GUI's browser webpack. webpack treats certain bare globals as
// magic and rewrites/corrupts them in the browser bundle:
//
//   require(           -> bundled/renamed; throws at runtime
//   process            -> shimmed to a partial object or stripped
//   Buffer / global    -> undefined in the browser; ReferenceError
//   __dirname / __filename / setImmediate / clearImmediate
//   dynamic import(    -> turned into a webpack chunk loader
//   import.meta        -> illegal in the eval'd handler scope
//
// A handler that embeds any of these as a BARE token (not a property access)
// will silently break the generated app. The contract is: handlers must use
// the guarded forms (e.g. `typeof require !== 'undefined' ? require : ...`
// where `require` appears only as a bare VALUE with no `(`, and
// `(globalThis as any).process` where `process` is a PROPERTY access).
//
// This test generates EVERY registered node's handler(s) and asserts the
// emitted code is free of the fragile bare tokens. If it ever fails it names
// the offending node types and which token tripped, so a future engineer
// knows exactly what to fix. Keep this scan logic in sync with
// /tmp/scan-handlers.js (the ad-hoc diagnostic it was lifted from).

/**
 * Strip block (`/* ... *​/`) and line (`// ...`) comments so a token mentioned
 * only in a code comment can't trip the scan. URLs like `https://example.com`
 * are preserved: the line-comment regex only matches `//` that is NOT preceded
 * by a `:` (so `://` survives).
 */
const stripComments = (code: string): string => {
  let out = code.replace(/\/\*[\s\S]*?\*\//g, '') // block comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line comments, keep `://` URLs
  return out
}

// [label, regex] — matches the bare/fragile form of each token.
const CHECKS: Array<[string, RegExp]> = [
  // require ONLY when used as a call: `require(`. The guarded bare-value form
  // (`typeof require !== 'undefined' ? require : ...`) has no `(` and is fine.
  ['require(', /(?<![\w.])require\s*\(/g],
  // bare `process` not preceded by `.` — so `(globalThis as any).process` is OK.
  ['process', /(?<!\.)\bprocess\b/g],
  ['Buffer', /(?<!\.)\bBuffer\b/g],
  // bare `global` but NOT `globalThis`: the `\b` after `global` fails before
  // the `T` in `globalThis`, so `globalThis` never matches.
  ['global', /(?<!\.)\bglobal\b/g],
  ['__dirname', /(?<!\.)\b__dirname\b/g],
  ['__filename', /(?<!\.)\b__filename\b/g],
  ['setImmediate', /(?<!\.)\bsetImmediate\b/g],
  ['clearImmediate', /(?<!\.)\bclearImmediate\b/g],
  ['dynamic-import(', /\bimport\s*\(/g],
  ['import.meta', /\bimport\.meta\b/g],
]

interface Offense {
  type: string
  tokens: Record<string, number>
}

const scanRegistry = (): { offenses: Offense[]; emitErrors: string[]; typeCount: number } => {
  const types = Object.keys(nodeRegistry).sort()
  const offenses: Offense[] = []
  const emitErrors: string[] = []

  for (const type of types) {
    const generator = nodeRegistry[type]
    let emitted = ''
    try {
      if (typeof generator.generateHandler === 'function') {
        emitted += '\n' + generator.generateHandler()
      }
      if (typeof generator.generateServerHandler === 'function') {
        emitted += '\n' + generator.generateServerHandler!()
      }
    } catch (err) {
      emitErrors.push(`${type}: ${(err as Error).message}`)
      continue
    }

    const clean = stripComments(emitted)
    const tokens: Record<string, number> = {}
    for (const [label, regex] of CHECKS) {
      const matches = clean.match(regex)
      if (matches && matches.length) {
        tokens[label] = matches.length
      }
    }
    if (Object.keys(tokens).length) {
      offenses.push({ type, tokens })
    }
  }

  return { offenses, emitErrors, typeCount: types.length }
}

describe('webpack-safe handler emission', () => {
  const { offenses, emitErrors, typeCount } = scanRegistry()

  it('generates handlers for every registered node without throwing', () => {
    expect(emitErrors).toEqual([])
  })

  it('emits NO webpack-fragile bare tokens in any handler', () => {
    if (offenses.length === 0) {
      expect(offenses).toEqual([])
      return
    }

    const detail = offenses.map((o) => `  - ${o.type}: ${JSON.stringify(o.tokens)}`).join('\n')
    const message =
      `${offenses.length} of ${typeCount} node handler(s) emit webpack-fragile ` +
      `bare tokens that the browser webpack will corrupt. Fix the listed nodes to ` +
      `use guarded forms (bare-value \`require\`, \`(globalThis as any).process\`, ` +
      `etc.):\n${detail}`

    // Fail with the full list of offending node types + which token each tripped.
    throw new Error(message)
  })
})
