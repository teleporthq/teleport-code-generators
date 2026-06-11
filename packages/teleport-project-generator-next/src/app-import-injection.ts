import { ProjectPluginStructure } from '@teleporthq/teleport-types'

/**
 * Splices an import line into the generated _app file, before the first
 * existing import. Idempotent: a second call with the same line is a no-op.
 *
 * Inserting before the first import keeps injected stylesheet imports ahead
 * of `import './style.css'`, so project styles win over library styles on
 * equal specificity.
 */
export const injectImportIntoApp = (
  structure: ProjectPluginStructure,
  importLine: string
): void => {
  const { files } = structure

  let appFile: { content: string } | null = null
  for (const [key, record] of Array.from(files.entries())) {
    if (key === '_app' || key.includes('_app')) {
      const candidate = record.files?.find(
        (file) => file.name === '_app' && (file.fileType === 'js' || file.fileType === 'tsx')
      )
      if (candidate) {
        appFile = candidate
        break
      }
    }
  }

  if (!appFile || typeof appFile.content !== 'string') {
    return
  }

  if (appFile.content.includes(importLine)) {
    return
  }

  const lineWithBreak = `${importLine}\n`
  const firstImportIdx = appFile.content.indexOf('import ')
  appFile.content =
    firstImportIdx >= 0
      ? appFile.content.slice(0, firstImportIdx) +
        lineWithBreak +
        appFile.content.slice(firstImportIdx)
      : lineWithBreak + appFile.content
}
