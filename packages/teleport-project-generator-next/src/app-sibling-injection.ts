import { GeneratedFile, ProjectPluginStructure } from '@teleporthq/teleport-types'

/**
 * Injects a null-rendering client component as a sibling of the app's returned
 * JSX in `pages/_app`. Proven string-surgery (shared by the analytics tracker
 * and the nav active-link highlighter): add the import before the first import,
 * then wrap the returned JSX in a fragment with `<Component />` as a sibling.
 *
 * Idempotent — a second call for the same `componentName` is a no-op. Safe: if
 * `_app` cannot be located or parsed, the structure is left untouched.
 */
export function injectSiblingIntoApp(
  structure: ProjectPluginStructure,
  params: { componentName: string; importStatement: string }
): void {
  const { files } = structure
  const { componentName, importStatement } = params

  let appFile: GeneratedFile | null = null
  for (const [key, record] of Array.from(files.entries())) {
    if (key === '_app' || key.includes('_app')) {
      const found = record.files?.find(
        (file: GeneratedFile) =>
          file.name === '_app' && (file.fileType === 'js' || file.fileType === 'tsx')
      )
      if (found) {
        appFile = found
        break
      }
    }
  }

  if (!appFile || typeof appFile.content !== 'string') {
    return
  }
  if (appFile.content.includes(componentName)) {
    return
  }

  let content = appFile.content

  const firstImportIdx = content.indexOf('import ')
  if (firstImportIdx >= 0) {
    content = content.slice(0, firstImportIdx) + importStatement + content.slice(firstImportIdx)
  } else {
    content = importStatement + content
  }

  const returnMatch = content.match(/return\s*\(\s*/)
  if (returnMatch && returnMatch.index !== undefined) {
    const afterReturn = returnMatch.index + returnMatch[0].length
    const restContent = content.slice(afterReturn)
    const closingParenIdx = findMatchingClosingParen(restContent)
    if (closingParenIdx >= 0) {
      const innerJSX = restContent.slice(0, closingParenIdx)
      const afterClosing = restContent.slice(closingParenIdx)
      // Both halves of the fragment are required — omitting `</>` produces a
      // syntax error in _app.js.
      content =
        content.slice(0, afterReturn) + `<>${innerJSX}<${componentName} /></>` + afterClosing
    }
  }

  appFile.content = content
}

function findMatchingClosingParen(str: string): number {
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') {
      depth++
    }
    if (ch === ')') {
      if (depth === 0) {
        return i
      }
      depth--
    }
  }
  return -1
}
