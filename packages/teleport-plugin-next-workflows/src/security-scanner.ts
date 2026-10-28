/**
 * Codegen-time security gate. Run from `NextWorkflowProjectPlugin.runBefore`
 * over every `general-custom-js` node's `config.code`. Refuses to generate
 * code containing obvious protected-env-var access or sandbox-escape
 * primitives so the codegen pipeline can't be coerced into shipping
 * dangerous workflow code even if the GUI and services-worker layers were
 * bypassed.
 *
 * Intentionally narrow + regex-based: the GUI runs the full AST scan
 * (workflow-schema/src/security/scan-custom-js.ts) before the project
 * reaches codegen, and the services-worker re-runs it on the publish
 * payload. This file is the cheap third checkpoint — it catches the
 * obvious naïve patterns and is cheap enough to run inside the codegen
 * pipeline without pulling @babel/parser into this package.
 *
 * SINGLE SOURCE OF TRUTH for the protected names — keep in sync with:
 *   - teleport-gui/packages/workflow-schema/src/security/protected-env-names.ts
 *   - teleport-services-worker/src/modules/vercel/security/protected-env-names.ts
 *   - the runtime shadow in nodes/general/general-custom-js.ts
 * (`__tests__/security-lists-parity.test.ts` fails when they drift). Every
 * secret TeleportHQ keeps for the site (`SYSTEM_MANAGED_SECRET_NAMES`, GUI and
 * worker) is one of them: the app secret signs every session and is what the
 * site's own server code presents to its routes.
 */

export const PROTECTED_ENV_NAMES = [
  'TELEPORT_DB_CONNECTION_STRING',
  'RUNTIME_STORAGE_API_KEY',
  'RUNTIME_STORAGE_PROJECT_ID',
  'TELEPORT_PROJECT_TOKEN',
  'REALTIME_SERVER_API_KEY',
  'REALTIME_SERVER_URL',
  'PDF_SERVICE_URL',
  'PDF_SERVICE_API_KEY',
  'TELEPORT_CRON_SECRET',
  'TELEPORT_CRON_SECRET_PREVIOUS',
  'NEXTAUTH_SECRET',
  'AUTH_PEPPER_SECRET',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'TQ_CACHE_SECRET',
  // The site's newsletter service key and the services worker's address: only
  // the admin panel's newsletter route reads them.
  'NEWSLETTER_SERVICE_TOKEN',
  'NEWSLETTER_SERVICE_URL',
  // The password wall's secret. Only the wall reads it.
  'TELEPORT_WALL_SECRET',
] as const

/**
 * The merchant's payment-provider credentials, under the name a deploy writes
 * (`STRIPE_SECRET_KEY`) or the one the editor stores (`CONFIGURATION_STRIPE_…`,
 * numbered on a second save). Only the store's payment drivers read them: a
 * server script that could would hand the merchant's API key to any visitor.
 * Mirror of the GUI's `PROTECTED_ENV_NAME_PATTERN`; the runtime guard in
 * `general-custom-js.ts` denies the same names.
 */
export const PROTECTED_ENV_NAME_PATTERN =
  /^(?:CONFIGURATION_)?(?:STRIPE|PAYPAL|MOLLIE|RAZORPAY|SQUARE|PADDLE|COINGATE)_[A-Z0-9_]+$/

/**
 * Every `TELEPORT_DB_` name: the TeleportHQ database the platform provisions —
 * `TELEPORT_DB_CONNECTION_STRING`, the HOST / PORT / USER / PASSWORD / NAME /
 * SSL parts a self-hosted site may set instead, and whatever part a later one
 * names. Platform secrets like the list above (the GUI refuses them in a node
 * config too). Mirror of the GUI's `PLATFORM_ENV_NAME_PATTERN`; the runtime
 * guard in `general-custom-js.ts` denies the same names.
 */
export const PLATFORM_ENV_NAME_PATTERN = /^TELEPORT_DB_[A-Z0-9_]+$/

/**
 * Every `__` name: what TeleportHQ's integrations keep for the editor
 * (`__gsc_*`, `__google_merchant_*`, `__social_oauth_<platform>_*`, another
 * member's sign-in). A build published before 2026-10-26 carries them in its
 * environment. Mirror of the GUI's `INTEGRATION_ENV_NAME_PATTERN`; the runtime
 * guard in `general-custom-js.ts` denies the same names.
 */
export const INTEGRATION_ENV_NAME_PATTERN = /^__[A-Za-z0-9_]+$/

/**
 * Such a name read from `env` (`env.__x`, `env['__x']`). Only in that
 * position: `__proto__` or `__dirname` elsewhere in the code is not one.
 */
const INTEGRATION_ENV_READ = /\benv\s*(?:\.\s*|\[\s*["'`])(__[A-Za-z0-9_]+)/g

/**
 * Sandbox escapes the runtime's `process` shadow cannot stop: the Function
 * constructor reached through any function's `constructor` runs in the real
 * global scope (`(function(){}).constructor('return process')()`,
 * `Function.prototype.constructor(...)`, an async or generator function's),
 * `process.env` read through a property descriptor or `Reflect`, and a scan of
 * the global object for something that looks like `process`. Matched against
 * the code with comments stripped and escapes decoded.
 *
 * SAME ENTRIES, kept in sync with:
 *   - teleport-gui/packages/workflow-schema/src/security/sandbox-escape-patterns.ts
 *   - teleport-services-worker/src/modules/vercel/security/sandbox-escape-patterns.ts
 */
export const SANDBOX_ESCAPE_PATTERNS: ReadonlyArray<{
  ruleId: 'sandbox-escape-constructor' | 'indirect-process-access' | 'global-enumeration'
  message: string
  pattern: RegExp
}> = [
  {
    ruleId: 'sandbox-escape-constructor',
    message:
      'reaches a function constructor through .constructor (compare it or read .name instead)',
    pattern: /\.\s*constructor\b(?!\s*(?:[!=]==?|\.\s*name\b))/,
  },
  {
    ruleId: 'sandbox-escape-constructor',
    message: 'names "constructor" as a key',
    pattern: /["'`]constructor["'`]/,
  },
  {
    ruleId: 'sandbox-escape-constructor',
    message: 'destructures constructor',
    pattern: /[{,]\s*constructor\s*[:,}=]/,
  },
  {
    ruleId: 'indirect-process-access',
    message: 'reads process through a property descriptor or Reflect',
    pattern:
      /\b(?:Object\s*\.\s*getOwnPropertyDescriptors?|Reflect\s*\.\s*(?:get|getOwnPropertyDescriptor|ownKeys|has))\s*\(\s*(?:(?:globalThis|global)\s*\.\s*)?process\b/,
  },
  {
    ruleId: 'indirect-process-access',
    message: 'returns this from a plain function (the global object outside strict mode)',
    pattern: /\bfunction\b[^{}]*\{\s*return\s+this\s*;?\s*\}/,
  },
  {
    ruleId: 'global-enumeration',
    message: 'enumerates the global object',
    pattern:
      /\b(?:Object\s*\.\s*(?:keys|values|entries|getOwnPropertyNames|getOwnPropertyDescriptors)|Reflect\s*\.\s*ownKeys)\s*\(\s*(?:globalThis|global)\s*\)/,
  },
  {
    ruleId: 'global-enumeration',
    message: 'iterates the global object',
    pattern: /\bfor\s*\(\s*(?:var|let|const)?\s*\w+\s+(?:in|of)\s+(?:globalThis|global)\b/,
  },
]

/**
 * Joins adjacent string literals (`'const' + 'ructor'` → `'constructor'`), so a
 * name split to slip past the patterns is matched whole. The patterns are
 * matched against the folded code. Same function in the two other copies.
 */
export const foldStringConcatenations = (code: string): string => {
  const pair = /(["'])((?:(?!\1)[^\\\n])*)\1\s*\+\s*(["'])((?:(?!\3)[^\\\n])*)\3/g
  let previous = ''
  let folded = code
  while (folded !== previous) {
    previous = folded
    folded = folded.replace(
      pair,
      (whole: string, _open: string, left: string, _next: string, right: string) => {
        const joined = left + right
        const quote = joined.indexOf("'") === -1 ? "'" : joined.indexOf('"') === -1 ? '"' : ''
        return quote ? quote + joined + quote : whole
      }
    )
  }
  return folded
}

export interface CodegenSecurityViolation {
  workflowId: string
  workflowName?: string
  nodeId: string
  rule: string
  message: string
}

export class CodegenSecurityError extends Error {
  constructor(public readonly violations: CodegenSecurityViolation[]) {
    super(
      `Codegen blocked by ${violations.length} security violation${
        violations.length === 1 ? '' : 's'
      }`
    )
    this.name = 'CodegenSecurityError'
    // ES5 target breaks the prototype chain when extending built-ins like
    // Error — restore it so `instanceof CodegenSecurityError` works.
    Object.setPrototypeOf(this, CodegenSecurityError.prototype)
  }
}

interface WorkflowNodeLike {
  id?: string
  config?: { code?: string }
}

interface WorkflowLike {
  id?: string
  name?: string
  nodes?: WorkflowNodeLike[]
}

interface WorkflowsContainer {
  workflows?: Record<string, WorkflowLike>
  customNodes?: Record<string, WorkflowLike>
}

/**
 * Walks the UIDL workflow definitions and custom nodes and throws
 * `CodegenSecurityError` if any `general-custom-js` body trips the scanner.
 * A custom node's code runs on the server too (its own segment routes, and
 * in process inside the cron, webhook and automation routes that call it):
 * its violation names the custom node (`workflowId` is the custom node's id).
 *
 * Per `general-custom-js` the only place a user can write JS is the `code`
 * config field, so we look only there. Other node types use structured
 * configs we don't touch.
 */
export function assertWorkflowsAreSecure(workflowsContainer: WorkflowsContainer | undefined): void {
  if (!workflowsContainer) return
  const violations: CodegenSecurityViolation[] = []
  const owners = [
    ...Object.entries(workflowsContainer.workflows || {}),
    ...Object.entries(workflowsContainer.customNodes || {}),
  ]
  for (const [wfId, wf] of owners) {
    if (!wf || !Array.isArray(wf.nodes)) continue
    for (const node of wf.nodes) {
      const nodeAsUnknown = node as unknown as {
        type?: string
        config?: { code?: string }
        id?: string
      }
      if (nodeAsUnknown?.type !== 'general-custom-js') continue
      const code = nodeAsUnknown.config?.code as unknown
      if (code === undefined || code === null || code === '') continue
      // Code the runtime would resolve before compiling it (a token, a context
      // value, a secret, an inserted value) is whatever it resolves to.
      const findings = isAuthoredText(code)
        ? scanForObviousViolations(code)
        : [{ rule: 'unreadable-step-code', message: REFERENCE_CODE_MESSAGE }]
      for (const finding of findings) {
        violations.push({
          workflowId: wfId,
          workflowName: wf.name,
          nodeId: nodeAsUnknown.id ?? '?',
          rule: finding.rule,
          message: finding.message,
        })
      }
    }
  }
  if (violations.length > 0) throw new CodegenSecurityError(violations)
}

interface ScannerFinding {
  rule: string
  message: string
}

/**
 * `process.env` read as a value — the whole environment — or with a key the
 * code does not spell out: the editor's `process-without-property` and
 * `dynamic-env-access` (teleport-gui `workflow-schema/src/security/scan-custom-js.ts`,
 * and the worker's copy), read from the text. A `process.env` only tested for
 * its truth (`!process.env`, `process.env ? … : …`, `process.env && …`), or
 * named into a variable whose properties are read, is not one; a key written
 * as a string, or as a variable the code sets to one, is spelled out.
 */
const ENV_READ = /\bprocess\s*(?:\?\.|\.)\s*env\b/g

function envReadFindings(code: string): ScannerFinding[] {
  let bare = false
  let dynamic = false
  ENV_READ.lastIndex = 0
  for (let match = ENV_READ.exec(code); match !== null; match = ENV_READ.exec(code)) {
    const before = code.slice(0, match.index)
    const after = code.slice(match.index + match[0].length)
    const key = /^\s*(?:\?\.\s*)?\[\s*([^\]]*?)\s*\]/.exec(after)
    if (key) {
      const spelled =
        /^(["'`])[^"'`\\]*\1$/.test(key[1]) ||
        (/^[A-Za-z_$][\w$]*$/.test(key[1]) &&
          new RegExp(
            `\\b(?:const|let|var)\\s+${key[1].replace(/\$/g, '\\$')}\\s*=\\s*(["'\`])[^"'\`]*\\1`
          ).test(code))
      if (!spelled) {
        dynamic = true
      }
      continue
    }
    if (/^\s*(?:\?\.|\.|\[)/.test(after)) {
      continue
    }
    if (/^\s*(?:\?(?![.?])|&&|\|\||[!=]==?)/.test(after)) {
      continue
    }
    if (
      /(?:!|\btypeof|\bif\s*\(|\bwhile\s*\(|\bBoolean\s*\(|&&|\|\||\b(?:const|let|var)\s+[\w$]+\s*=)\s*$/.test(
        before
      )
    ) {
      continue
    }
    bare = true
  }
  const out: ScannerFinding[] = []
  if (bare) {
    out.push({
      rule: 'process-without-property',
      message: 'uses process.env as a value, which exposes every variable',
    })
  }
  if (dynamic) {
    out.push({
      rule: 'dynamic-env-access',
      message: 'reads process.env with a key it does not spell out',
    })
  }
  return out
}

const REFERENCE_CODE_MESSAGE =
  'uses a reference as its code (a {{…}} token, a context value, a secret or an inserted value): the server would compile whatever it resolves to'

/**
 * Text the author wrote, which the runtime compiles as it is
 * (`isAuthoredText` / `resolveNodeConfig` in executor-generator.ts): a string with no inserted
 * value, not a whole `{{…}}` token, not a secret reference. Mirrors
 * teleport-gui `workflow-schema/src/security/compiled-code.ts` and the worker's
 * `security-precheck.ts` (`isAuthoredText`).
 */
export const isAuthoredText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.indexOf('context-value-inline') === -1 &&
  !/^\s*\{\{[\s\S]*\}\}\s*$/.test(value) &&
  value.indexOf('WORKFLOW_SECRET_') !== 0 &&
  value.indexOf('teleporthq.secrets.') !== 0

/**
 * Regex-based scan. Sufficient at the codegen layer because:
 *   - the GUI's AST scanner has already vetted the code.
 *   - the services-worker re-runs the full AST scan on the publish payload.
 *   - the runtime `process` Proxy preamble denies even successful escapes.
 */
export function scanForObviousViolations(rawCode: string): ScannerFinding[] {
  const out: ScannerFinding[] = []
  const code = stripCommentsAndDecodeEscapes(rawCode)

  for (const name of PROTECTED_ENV_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(code)) {
      out.push({
        rule: 'protected-env-access',
        message: `references protected platform secret "${name}"`,
      })
    }
  }
  const words = code.match(/\b[A-Z][A-Z0-9_]+\b/g) || []
  const platformNames = words.filter(
    (word) =>
      PLATFORM_ENV_NAME_PATTERN.test(word) &&
      (PROTECTED_ENV_NAMES as ReadonlyArray<string>).indexOf(word) === -1
  )
  for (const name of Array.from(new Set(platformNames))) {
    out.push({
      rule: 'protected-env-access',
      message: `references protected platform secret "${name}"`,
    })
  }
  const credentialNames = words.filter((word) => PROTECTED_ENV_NAME_PATTERN.test(word))
  for (const name of Array.from(new Set(credentialNames))) {
    out.push({
      rule: 'protected-env-access',
      message: `references payment credential "${name}"`,
    })
  }
  const integrationNames: string[] = []
  INTEGRATION_ENV_READ.lastIndex = 0
  for (
    let read = INTEGRATION_ENV_READ.exec(code);
    read !== null;
    read = INTEGRATION_ENV_READ.exec(code)
  ) {
    integrationNames.push(read[1])
  }
  for (const name of Array.from(new Set(integrationNames))) {
    out.push({
      rule: 'protected-env-access',
      message: `reads integration secret "${name}"`,
    })
  }
  if (/\beval\s*\(/.test(code)) {
    out.push({ rule: 'sandbox-escape-eval', message: 'calls eval(...)' })
  }
  if (/\b(?:new\s+)?Function\s*\(/.test(code)) {
    out.push({
      rule: 'sandbox-escape-function',
      message: 'uses Function(...) or new Function(...)',
    })
  }
  if (/\bwith\s*\(/.test(code)) {
    out.push({ rule: 'sandbox-escape-with', message: 'uses a with statement' })
  }
  if (
    /\brequire\s*\(\s*["'`](?:fs(?:\/promises)?|child_process|cluster|worker_threads|process|vm|inspector|dgram|v8|node:[^"'`]+)["'`]/.test(
      code
    )
  ) {
    out.push({
      rule: 'forbidden-require',
      message: 'requires a forbidden Node.js module',
    })
  }
  if (
    /\bimport\s*\(\s*["'`](?:fs(?:\/promises)?|child_process|cluster|worker_threads|process|vm|inspector|dgram|v8|node:[^"'`]+)["'`]/.test(
      code
    )
  ) {
    out.push({
      rule: 'forbidden-dynamic-import',
      message: 'dynamically imports a forbidden Node.js module',
    })
  }
  if (/\b(?:globalThis|global)\s*[\.\[]\s*["'`]?process\b/.test(code)) {
    out.push({
      rule: 'indirect-process-access',
      message: 'reaches process via globalThis / global',
    })
  }
  const folded = foldStringConcatenations(code)
  for (const escape of SANDBOX_ESCAPE_PATTERNS) {
    if (escape.pattern.test(folded)) {
      out.push({ rule: escape.ruleId, message: escape.message })
    }
  }
  out.push(...envReadFindings(code))
  // Mass enumeration of process.env
  if (
    /\bObject\.(?:keys|values|entries|assign|fromEntries|getOwnProperty(?:Names|Symbols|Descriptors))\s*\(\s*(?:[^)]*,\s*)?process\.env\b/.test(
      code
    ) ||
    /\bJSON\.stringify\s*\(\s*process\.env\b/.test(code) ||
    /\bReflect\.ownKeys\s*\(\s*process\.env\b/.test(code) ||
    /\{\s*\.\.\.process\.env\b/.test(code) ||
    /\bfor\s*\(\s*(?:var|let|const)?\s*\w+\s+(?:in|of)\s+process\.env\b/.test(code)
  ) {
    out.push({
      rule: 'mass-env-enumeration',
      message: 'enumerates or copies the entire process.env',
    })
  }
  return out
}

function stripCommentsAndDecodeEscapes(input: string): string {
  let stripped = input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  stripped = stripped
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
  return stripped
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}
