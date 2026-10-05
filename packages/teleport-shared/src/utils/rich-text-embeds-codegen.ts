/**
 * Code-generation helpers for the rich-text embed contract.
 *
 * Kept apart from `rich-text-embeds.ts` on purpose: that module is imported by
 * the studio editor and the canvas renderer, which are BROWSER bundles. Only
 * the project generator imports this file.
 */
import { EMBED_PROVIDERS } from './rich-text-embeds'
import { EMBED_RUNTIME_MODULE_SOURCE } from './rich-text-embeds-runtime-source'

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

/**
 * `components/embed-runtime.js` for the generated project: the helpers its
 * rich-text editor builds embeds with and its activator mounts them with.
 *
 * A STRING committed beside this file, not printed from the functions with
 * `Function.prototype.toString` at generation time: teleport-gui runs this
 * generator inside a minified bundle, where the minifier renames every one of
 * those functions and the constants they read, so the emitted module exported
 * none of the names the activator imports. A minifier never rewrites a string
 * literal. `__tests__/utils/rich-text-embeds-runtime-module.ts` fails when the
 * string drifts from `rich-text-embeds.ts` and regenerates it with
 * UPDATE_EMBED_RUNTIME=1.
 */
export function generateEmbedRuntimeModuleSource(): string {
  return EMBED_RUNTIME_MODULE_SOURCE
}
