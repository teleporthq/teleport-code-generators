/**
 * How a node handler reaches the shared workflow runtime (`runtime-utils.js`).
 *
 * Handlers are authored as plain functions and inlined by `.toString()` into
 * several generated files — the client and server handler maps, the global
 * workflows hook and every API route — which sit in different directories, so
 * a `require` with a relative path inside a handler could not resolve from all
 * of them. Instead, each of those files binds the runtime to this one
 * identifier before its first handler, and a handler that needs a helper the
 * runtime owns (currently the locale-aware `localizeHref`) calls it through
 * the alias. `nodes/workflow-utils-global.d.ts` declares it for the handler
 * sources; the tests that evaluate emitted handler code bind it themselves.
 */
export const WORKFLOW_UTILS_ALIAS = '__workflowUtils'

/** The binding for a CommonJS file: `var __workflowUtils = require('<specifier>');` */
export const workflowUtilsRequireLine = (specifier: string): string =>
  `var ${WORKFLOW_UTILS_ALIAS} = require('${specifier}');`

/** The binding for an ES module file: `import __workflowUtils from '<specifier>';` */
export const workflowUtilsImportLine = (specifier: string): string =>
  `import ${WORKFLOW_UTILS_ALIAS} from '${specifier}';`

/** The binding for a file that already holds the runtime in `<identifier>`. */
export const workflowUtilsAliasLine = (identifier: string): string =>
  `const ${WORKFLOW_UTILS_ALIAS} = ${identifier};`
