import {
  CodegenSecurityError,
  CodegenSecurityViolation,
  scanForObviousViolations,
} from './security-scanner'

/**
 * Author code a published page runs on the server beside its workflows, read
 * from the UIDL before any of it is emitted (`NextWorkflowProjectPlugin.runBefore`):
 *
 * - a state's mapping function (`mappingFunction`): a page's `getStaticProps`
 *   compiles it with `Function('items', …)` at build and on every revalidation
 *   (teleport-project-generator-next `state-data-source-plugin.ts`);
 * - an expression node (`{ type: 'expr', content }`, an element's text, an
 *   attribute, a condition): it is written into the page's JSX, which Next
 *   prerenders in Node with the deploy's environment (an object is written as
 *   JSON, so a bare `process.env` would print every variable), and the invoice
 *   PDF route evaluates the template's.
 *
 * Both are held to the custom-code rules (`scanForObviousViolations`, the same
 * scanner custom-JS steps are), as the editor's publish gate holds them to its
 * own (teleport-gui `workflow-schema/src/security/scan-server-sources.ts`). The
 * whole tree is read, however deep it nests.
 */

const describeOwner = (ownerName: string, record: Record<string, unknown>): string =>
  typeof record.name === 'string' && record.name.trim() ? record.name.trim() : ownerName

interface Pending {
  value: unknown
  ownerName: string
  path: string
}

export const findProjectCodeViolations = (uidl: {
  root?: unknown
  components?: Record<string, unknown>
}): CodegenSecurityViolation[] => {
  const violations: CodegenSecurityViolation[] = []
  const seen = new Set<unknown>()
  const report = (ownerName: string, nodeId: string, what: string, code: string) => {
    for (const finding of scanForObviousViolations(code)) {
      violations.push({
        workflowId: ownerName,
        workflowName: ownerName,
        nodeId,
        rule: finding.rule,
        message: `${what} ${finding.message}`,
      })
    }
  }

  const pending: Pending[] = [{ value: uidl.root, ownerName: 'the pages', path: 'root' }]
  for (const [componentName, component] of Object.entries(uidl.components || {})) {
    pending.push({
      value: component,
      ownerName: componentName,
      path: `components.${componentName}`,
    })
  }
  // An explicit stack, not recursion: no nesting depth is skipped.
  while (pending.length > 0) {
    const { value, ownerName, path } = pending.pop() as Pending
    if (!value || typeof value !== 'object' || seen.has(value)) {
      continue
    }
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        pending.push({ value: item, ownerName, path: `${path}.${index}` })
      )
      continue
    }
    const record = value as Record<string, unknown>
    if (typeof record.mappingFunction === 'string' && record.mappingFunction.trim()) {
      report(ownerName, `${path}.mappingFunction`, 'the mapping function', record.mappingFunction)
    }
    if (record.type === 'expr' && typeof record.content === 'string' && record.content.trim()) {
      report(ownerName, `${path}.content`, 'an expression', record.content)
    }
    const childOwner = describeOwner(ownerName, record)
    for (const key of Object.keys(record)) {
      pending.push({ value: record[key], ownerName: childOwner, path: `${path}.${key}` })
    }
  }
  return violations
}

/** Throws `CodegenSecurityError` when a page or component carries such code. */
export const assertProjectCodeIsSecure = (uidl: {
  root?: unknown
  components?: Record<string, unknown>
}): void => {
  const violations = findProjectCodeViolations(uidl)
  if (violations.length > 0) {
    throw new CodegenSecurityError(violations)
  }
}
