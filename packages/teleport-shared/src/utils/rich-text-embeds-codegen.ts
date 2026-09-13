/**
 * Code-generation helpers for the rich-text embed contract.
 *
 * Kept apart from `rich-text-embeds.ts` on purpose: that module is imported by
 * the studio editor and the canvas renderer, which are BROWSER bundles, and the
 * function registry below holds a live reference to every helper so that none
 * of them can be tree-shaken. Only the project generator imports this file.
 */
import {
  CUSTOM_EMBED_PROVIDER_ID,
  DEFAULT_EMBED_ALIGN,
  DEFAULT_EMBED_SANDBOX_LEVEL,
  DEFAULT_EMBED_WIDTH,
  EMBED_ALIGNMENTS,
  EMBED_ATTR,
  EMBED_BLOT_NAME,
  EMBED_CAPTION_CLASS_NAME,
  EMBED_CAPTION_STYLE,
  EMBED_CLASS_NAME,
  EMBED_FRAME_CLASS_NAME,
  EMBED_HEIGHT_MESSAGE_TYPE,
  EMBED_INITIAL_HEIGHT,
  EMBED_MAX_HEIGHT,
  EMBED_MIN_HEIGHT,
  EMBED_PROVIDERS,
  EMBED_SANDBOX_DOC_HEAD,
  EMBED_SANDBOX_DOC_TAIL,
  EMBED_SANDBOX_FLAGS_STRICT,
  EMBED_SANDBOX_FLAGS_TRUSTED,
  EMBED_TOKEN_PLACEHOLDER,
  GENERIC_EMBED_PROVIDER_ID,
  WIDESCREEN_EMBED_RATIO,
  applyEmbedTemplate,
  buildEmbedElementHtml,
  buildEmbedFrameChildren,
  buildEmbedHtmlFromUrl,
  buildEmbedSandboxDocument,
  clampEmbedWidth,
  createEmbedToken,
  createEmbedValue,
  decodeEmbedCode,
  embedBlockStyle,
  embedFrameStyle,
  encodeEmbedCode,
  escapeEmbedAttribute,
  escapeEmbedText,
  findEmbedFrame,
  isSafeEmbedUrl,
  normalizeEmbedAlign,
  normalizeEmbedsForStorage,
  parseEmbedHeightMessage,
  readEmbedValueFromElement,
  readEncodedEmbedCode,
  resolveEmbedMode,
  resolveEmbedProvider,
  resolveEmbedSandboxFlags,
} from './rich-text-embeds'

/**
 * The provider registry as a JavaScript literal, so the component the Next
 * generator writes is built from THIS array rather than a hand-copied one.
 * Regexes are re-created from their source and flags because `JSON.stringify`
 * flattens a `RegExp` to `{}`.
 */
export function serializeEmbedProvidersForRuntime(): string {
  const entries = EMBED_PROVIDERS.map((provider) => {
    const patterns = provider.patterns
      .map(
        (pattern) =>
          `new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)})`
      )
      .join(', ')
    return (
      `{ id: ${JSON.stringify(provider.id)}, label: ${JSON.stringify(provider.label)}, ` +
      `patterns: [${patterns}], template: ${JSON.stringify(provider.template)}, ` +
      `ratio: ${provider.ratio === null ? 'null' : String(provider.ratio)} }`
    )
  })
  return `[\n  ${entries.join(',\n  ')}\n]`
}

/* ── The generated runtime module ───────────────────────────────────────────
 *
 * The exported project needs these same helpers at runtime: its rich-text
 * editor builds embeds with them and its activator mounts them. Rather than
 * hand-copying the logic into a code-generator template — where it would drift
 * from this file the first time a provider is added — the module is EMITTED
 * from the very functions above: the constants are serialized, the functions
 * are printed with `Function.prototype.toString`, and the result is written to
 * the generated project as `components/embed-runtime.js`.
 *
 * Two rules keep that safe, and `__tests__/utils/rich-text-embeds.ts` pins both:
 *   - every emitted function may only reference other emitted functions and the
 *     constants below, never a module-private helper or an import;
 *   - the emitted module must parse and behave identically to this one.
 */

/**
 * Every function the generated editor and activator reach — the ones they
 * import, plus everything those call in turn. Deliberately not the whole of
 * `rich-text-embeds`: the editor overlay helpers belong to the studio, and an
 * export nothing calls is dead weight in every generated project.
 */
const RUNTIME_EXPORTS: Array<(...args: never[]) => unknown> = [
  isSafeEmbedUrl,
  resolveEmbedProvider,
  applyEmbedTemplate,
  buildEmbedHtmlFromUrl,
  resolveEmbedMode,
  clampEmbedWidth,
  normalizeEmbedAlign,
  escapeEmbedAttribute,
  escapeEmbedText,
  encodeEmbedCode,
  decodeEmbedCode,
  createEmbedValue,
  embedBlockStyle,
  embedFrameStyle,
  buildEmbedElementHtml,
  buildEmbedFrameChildren,
  findEmbedFrame,
  readEmbedValueFromElement,
  readEncodedEmbedCode,
  normalizeEmbedsForStorage,
  resolveEmbedSandboxFlags,
  buildEmbedSandboxDocument,
  parseEmbedHeightMessage,
  createEmbedToken,
]

interface RuntimeConstant {
  name: string
  literal: string
}

const runtimeConstant = (name: string, literal: string): RuntimeConstant => ({ name, literal })

/**
 * TypeScript's CommonJS emit rewrites every reference to an exported CONSTANT
 * as `exports.NAME` (exported functions keep their bare names, which is why
 * they can call each other). The generator runs against that CommonJS build, so
 * printed function bodies arrive carrying `exports.` prefixes that mean nothing
 * in the emitted module — where each constant is re-declared as a plain
 * top-level binding of the same name. Rewriting them back is therefore exact,
 * not a heuristic: only names this module emits are rewritten, and
 * `generateEmbedRuntimeModuleSource` asserts nothing module-scoped is left.
 */
const bindRuntimeConstantReferences = (source: string, names: string[]): string =>
  names.reduce((acc, name) => acc.replace(new RegExp(`\\bexports\\.${name}\\b`, 'g'), name), source)

export function generateEmbedRuntimeModuleSource(): string {
  const constants: RuntimeConstant[] = [
    runtimeConstant('EMBED_CLASS_NAME', JSON.stringify(EMBED_CLASS_NAME)),
    runtimeConstant('EMBED_FRAME_CLASS_NAME', JSON.stringify(EMBED_FRAME_CLASS_NAME)),
    runtimeConstant('EMBED_CAPTION_CLASS_NAME', JSON.stringify(EMBED_CAPTION_CLASS_NAME)),
    runtimeConstant('EMBED_BLOT_NAME', JSON.stringify(EMBED_BLOT_NAME)),
    runtimeConstant('EMBED_ATTR', JSON.stringify(EMBED_ATTR, null, 2)),
    runtimeConstant('EMBED_ALIGNMENTS', JSON.stringify(EMBED_ALIGNMENTS)),
    runtimeConstant('CUSTOM_EMBED_PROVIDER_ID', JSON.stringify(CUSTOM_EMBED_PROVIDER_ID)),
    runtimeConstant('GENERIC_EMBED_PROVIDER_ID', JSON.stringify(GENERIC_EMBED_PROVIDER_ID)),
    runtimeConstant('DEFAULT_EMBED_WIDTH', String(DEFAULT_EMBED_WIDTH)),
    runtimeConstant('DEFAULT_EMBED_ALIGN', JSON.stringify(DEFAULT_EMBED_ALIGN)),
    runtimeConstant('DEFAULT_EMBED_SANDBOX_LEVEL', JSON.stringify(DEFAULT_EMBED_SANDBOX_LEVEL)),
    runtimeConstant('WIDESCREEN_EMBED_RATIO', String(WIDESCREEN_EMBED_RATIO)),
    runtimeConstant('EMBED_CAPTION_STYLE', JSON.stringify(EMBED_CAPTION_STYLE)),
    runtimeConstant('EMBED_PROVIDERS', serializeEmbedProvidersForRuntime()),
    runtimeConstant('EMBED_SANDBOX_FLAGS_STRICT', JSON.stringify(EMBED_SANDBOX_FLAGS_STRICT)),
    runtimeConstant('EMBED_SANDBOX_FLAGS_TRUSTED', JSON.stringify(EMBED_SANDBOX_FLAGS_TRUSTED)),
    runtimeConstant('EMBED_HEIGHT_MESSAGE_TYPE', JSON.stringify(EMBED_HEIGHT_MESSAGE_TYPE)),
    runtimeConstant('EMBED_TOKEN_PLACEHOLDER', JSON.stringify(EMBED_TOKEN_PLACEHOLDER)),
    runtimeConstant('EMBED_MIN_HEIGHT', String(EMBED_MIN_HEIGHT)),
    runtimeConstant('EMBED_MAX_HEIGHT', String(EMBED_MAX_HEIGHT)),
    runtimeConstant('EMBED_INITIAL_HEIGHT', String(EMBED_INITIAL_HEIGHT)),
    runtimeConstant('EMBED_SANDBOX_DOC_HEAD', JSON.stringify(EMBED_SANDBOX_DOC_HEAD)),
    runtimeConstant('EMBED_SANDBOX_DOC_TAIL', JSON.stringify(EMBED_SANDBOX_DOC_TAIL)),
    // `createEmbedToken` closes over this counter.
    runtimeConstant('embedTokenCounter', '0'),
  ]

  const names = constants.map((entry) => entry.name)
  const declarations = constants.map((entry) => `export var ${entry.name} = ${entry.literal}`)
  const functions = RUNTIME_EXPORTS.map(
    (fn) => `export ${bindRuntimeConstantReferences(fn.toString(), names)}`
  )

  const source = `${RUNTIME_MODULE_HEADER}\n${declarations.join('\n\n')}\n\n${functions.join(
    '\n\n'
  )}\n`

  // An `exports.` reference that survived means a function reached for a
  // constant left off the list above. That crashes every generated project at
  // runtime, so it fails here instead. (Import leakage is covered by the
  // emitted module being evaluated in this package's tests — this module has
  // no imports, and must not gain any.)
  const leaked = source.match(/\bexports\.[A-Za-z_$][\w$]*/g)
  if (leaked) {
    throw new Error(
      `Embed runtime module cannot be emitted: unresolved module references ${leaked.join(', ')}`
    )
  }

  return source
}

const RUNTIME_MODULE_HEADER = `/**
 * Code embeds inside rich-text content — the shape the editor writes and the
 * page reads back. Generated from @teleporthq/teleport-shared; edit it there.
 *
 * An embed is stored inside the content HTML as a <figure class="tq-embed">.
 * Passive markup (a provider iframe) lives in the figure as real children, so
 * it renders server-side with no JavaScript. Markup that can execute — a
 * <script>, an on* handler, a javascript: URL — is base64-encoded onto the
 * element instead, and mounted at runtime inside a sandboxed iframe so it can
 * never reach this page.
 */
`
