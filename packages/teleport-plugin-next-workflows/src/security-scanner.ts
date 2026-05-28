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
] as const

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
}

/**
 * Walks the UIDL workflow definitions and throws `CodegenSecurityError` if
 * any `general-custom-js` body trips the scanner.
 *
 * Per `general-custom-js` the only place a user can write JS is the `code`
 * config field, so we look only there. Other node types use structured
 * configs we don't touch.
 */
export function assertWorkflowsAreSecure(workflowsContainer: WorkflowsContainer | undefined): void {
  if (!workflowsContainer?.workflows) return
  const violations: CodegenSecurityViolation[] = []
  for (const [wfId, wf] of Object.entries(workflowsContainer.workflows)) {
    if (!wf || !Array.isArray(wf.nodes)) continue
    for (const node of wf.nodes) {
      const nodeAsUnknown = node as unknown as {
        type?: string
        config?: { code?: string }
        id?: string
      }
      if (nodeAsUnknown?.type !== 'general-custom-js') continue
      const code = nodeAsUnknown.config?.code
      if (typeof code !== 'string' || !code.trim()) continue
      const findings = scanForObviousViolations(code)
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
 * Regex-based scan. Sufficient at the codegen layer because:
 *   - the GUI's AST scanner has already vetted the code.
 *   - the services-worker re-runs the full AST scan on the publish payload.
 *   - the runtime `process` Proxy preamble denies even successful escapes.
 */
function scanForObviousViolations(rawCode: string): ScannerFinding[] {
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
