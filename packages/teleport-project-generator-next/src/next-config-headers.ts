import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'

/** One rule of `next.config.js`'s `headers()`. */
export interface NextHeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}

const NEXT_CONFIG_KEY = 'next.config'
const MODULE_EXPORTS_OPENING = /module\.exports\s*=\s*\{/

// The rules the generator serves sit between these markers, as JSON: every
// plugin that serves headers (the security headers, the service worker's)
// adds to the ONE `headers()` whichever of them runs first. Next.js reads a
// single `headers` key, so a second method would replace the first.
const RULES_START = '/* teleport:header-rules */'
const RULES_END = '/* /teleport:header-rules */'

const renderRules = (rules: NextHeaderRule[]): string =>
  `${RULES_START} ${JSON.stringify(rules, null, 2).split('\n').join('\n    ')} ${RULES_END}`

const headersMethod = (rules: NextHeaderRule[]): string =>
  `  async headers() {\n    return ${renderRules(rules)}\n  },`

// A source is one rule; a header it already sets takes the newer value.
const mergeRules = (current: NextHeaderRule[], added: NextHeaderRule[]): NextHeaderRule[] => {
  const merged = current.map((rule) => ({ source: rule.source, headers: rule.headers.slice() }))
  added.forEach((rule) => {
    const same = merged.find((candidate) => candidate.source === rule.source)
    if (!same) {
      merged.push({ source: rule.source, headers: rule.headers.slice() })
      return
    }
    rule.headers.forEach((header) => {
      const index = same.headers.findIndex(
        (existing) => existing.key.toLowerCase() === header.key.toLowerCase()
      )
      if (index === -1) {
        same.headers.push(header)
      } else {
        same.headers[index] = header
      }
    })
  })
  return merged
}

/**
 * Serves `rules` through `next.config.js` — the one place that reaches both a
 * TeleportHQ deploy and a self-hosted export (the platform rewrites
 * `vercel.json`'s headers away). Creates the config when the project has
 * none, and leaves every other key of an existing one as it was. A `headers()`
 * the generator did not write is someone else's decision and is left alone.
 */
export const addNextConfigHeaderRules = (
  structure: ProjectPluginStructure,
  rules: NextHeaderRule[]
): void => {
  const configFile = structure.files
    .get(NEXT_CONFIG_KEY)
    ?.files.find((file) => file.name === NEXT_CONFIG_KEY && file.fileType === FileType.JS)

  if (!configFile) {
    structure.files.set(NEXT_CONFIG_KEY, {
      path: [],
      files: [
        {
          name: NEXT_CONFIG_KEY,
          fileType: FileType.JS,
          content: `module.exports = {\n${headersMethod(rules)}\n}\n`,
        },
      ],
    })
    return
  }

  const content = configFile.content
  const start = content.indexOf(RULES_START)
  const end = start === -1 ? -1 : content.indexOf(RULES_END, start)
  if (end !== -1) {
    const current: NextHeaderRule[] = JSON.parse(content.slice(start + RULES_START.length, end))
    configFile.content =
      content.slice(0, start) +
      renderRules(mergeRules(current, rules)) +
      content.slice(end + RULES_END.length)
    return
  }

  if (/async\s+headers\s*\(/.test(content)) {
    return
  }

  const opening = content.match(MODULE_EXPORTS_OPENING)
  if (!opening || opening.index === undefined) {
    return
  }
  const insertAt = opening.index + opening[0].length
  configFile.content =
    content.slice(0, insertAt) + `\n${headersMethod(rules)}` + content.slice(insertAt)
}
