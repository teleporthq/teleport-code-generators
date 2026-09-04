import { FileType, GeneratedFile, ProjectPluginStructure } from '@teleporthq/teleport-types'

/**
 * Adds a CSS block to the project's global stylesheet; when the project has
 * none (no tokens, no style sets) every page carries it inline instead.
 * Shared by the behavior plugins (Snap into view, scroll rail).
 */
export const appendGlobalCss = (structure: ProjectPluginStructure, css: string): void => {
  const styleSheet = structure.files.get('projectStyleSheet')
  const globalCss = styleSheet?.files.find((file) => file.fileType === FileType.CSS)
  if (styleSheet && globalCss) {
    structure.files.set('projectStyleSheet', {
      ...styleSheet,
      files: styleSheet.files.map((file: GeneratedFile) =>
        file === globalCss ? { ...file, content: `${file.content.trimEnd()}\n\n${css}` } : file
      ),
    })
    return
  }
  const styleTag = `<style>\n${css}</style>\n`
  mapHtmlPages(structure, (html) =>
    html.includes('</head>') ? html.replace('</head>', `${styleTag}</head>`) : `${styleTag}${html}`
  )
}

/** Adds an inline script to the end of every page. */
export const appendPageScript = (structure: ProjectPluginStructure, script: string): void => {
  const scriptTag = `<script>\n${script}\n</script>\n`
  mapHtmlPages(structure, (html) =>
    html.includes('</body>')
      ? html.replace('</body>', `${scriptTag}</body>`)
      : `${html}\n${scriptTag}`
  )
}

const mapHtmlPages = (
  structure: ProjectPluginStructure,
  transform: (html: string) => string
): void => {
  structure.files.forEach((entry, key) => {
    structure.files.set(key, {
      ...entry,
      files: entry.files.map((file: GeneratedFile) =>
        file.fileType === FileType.HTML ? { ...file, content: transform(file.content) } : file
      ),
    })
  })
}
