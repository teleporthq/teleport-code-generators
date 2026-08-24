import { ComponentPlugin, ComponentPluginFactory, HastNode } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { SUPPORTED_PROJECT_TYPES } from './utils'
import type { JSXElement, JSXIdentifier, JSXText } from '@babel/types'

interface ParseEmbedPluginConfig {
  projectType: SUPPORTED_PROJECT_TYPES
}

const SCRIPT_CLOSE_PH = '__THQ_SC__'

/**
 * Replace all `</script>` except the last one with a placeholder so
 * hast-util-from-html doesn't prematurely close the script element
 * when the JS code inside contains a nested `</script>` (e.g. in a
 * template-literal string).
 */
function escapeNestedScriptClose(html: string): string {
  const regex = /<\/script\s*>/gi
  const indices: Array<{ idx: number; len: number }> = []
  let m = regex.exec(html)
  while (m !== null) {
    indices.push({ idx: m.index, len: m[0].length })
    m = regex.exec(html)
  }
  if (indices.length <= 1) {
    return html
  }

  let result = ''
  let lastEnd = 0
  for (let i = 0; i < indices.length - 1; i++) {
    result += html.substring(lastEnd, indices[i].idx)
    result += SCRIPT_CLOSE_PH
    lastEnd = indices[i].idx + indices[i].len
  }
  result += html.substring(lastEnd)
  return result
}

/**
 * hast-util-to-jsx-inline-script wraps each <script> body in an outer {`…`}
 * template literal with NO escaping of its own (its <style> branch goes through
 * JSON.stringify; the script branch never got that treatment). A raw backtick
 * or `${` in the body therefore terminates/interpolates the OUTER literal and
 * the generated component does not compile.
 *
 * Escape both here, parity-aware and idempotent — the same algorithm as
 * teleport-plugin-common's addRawAttributeToJSXTag (the non-advanced-embeds
 * React path): a backtick behind an ODD number of backslashes is already
 * escaped and is left alone, so content that editors pre-escaped keeps exactly
 * one level of escaping, while raw content (the canonical storage form) gains
 * the one level it needs. Runs on the placeholder form produced by
 * escapeNestedScriptClose, so an inner `</script>` cannot end the match early.
 *
 * Exported for tests.
 */
export function escapeScriptBodiesForJsxTemplateLiteral(html: string): string {
  return html.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_fullMatch: string, openTag: string, body: string, closeTag: string) =>
      openTag +
      body
        .replace(/\\*`/g, (match: string) => {
          const backslashCount = match.length - 1
          return backslashCount % 2 === 0 ? match.slice(0, backslashCount) + '\\`' : match
        })
        .replace(/\\*\$\{/g, (match: string) => {
          const backslashCount = match.length - 2
          return backslashCount % 2 === 0 ? match.slice(0, backslashCount) + '\\${' : match
        }) +
      closeTag
  )
}

const NODE_MAPPER: Record<
  SUPPORTED_PROJECT_TYPES,
  Promise<(content: unknown, options: unknown) => string>
> = {
  'teleport-project-html': import('hast-util-to-html').then((mod) => mod.toHtml),
  'teleport-project-angular': import('hast-util-to-html').then((mod) => mod.toHtml),
  'teleport-project-vue': import('hast-util-to-html').then((mod) => mod.toHtml),
  'teleport-project-nuxt': import('hast-util-to-html').then((mod) => mod.toHtml),
  'teleport-project-react': import('hast-util-to-jsx-inline-script').then((mod) => mod.default),
  'teleport-project-next': import('hast-util-to-jsx-inline-script').then((mod) => mod.default),
}

const COMPONENT_CHUNK_NAMES: Record<SUPPORTED_PROJECT_TYPES, string> = {
  'teleport-project-html': 'html-chunk',
  'teleport-project-angular': 'template-chunk',
  'teleport-project-vue': 'template-chunk',
  'teleport-project-nuxt': 'template-chunk',
  'teleport-project-next': 'jsx-component',
  'teleport-project-react': 'jsx-component',
}

export const createParseEmbedPlugin: ComponentPluginFactory<ParseEmbedPluginConfig> = (config) => {
  const { projectType } = config

  if (!NODE_MAPPER[projectType]) {
    throw new Error(`Received a invalid ${projectType}`)
  }

  const componentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const compontnChunk = chunks.find((chunk) => chunk?.name === COMPONENT_CHUNK_NAMES[projectType])

    if (!compontnChunk) {
      throw new Error(`MIssing component chunk to parse for embeds`)
    }

    const fromHtml = (await import('hast-util-from-html')).fromHtml
    const hastToJsxOrHtml = await NODE_MAPPER[projectType]

    UIDLUtils.traverseElements(uidl.node, (element) => {
      const { key, elementType, attrs } = element

      if (
        (elementType === 'dangerous-html' || element.dependency?.path === 'dangerous-html') &&
        attrs?.html
      ) {
        if (attrs.html.type === 'raw' && (attrs.html as any).dynamic) {
          return
        }

        let rawHtmlContent = element.attrs.html.content as string

        if (
          projectType === 'teleport-project-html' ||
          projectType === 'teleport-project-angular' ||
          projectType === 'teleport-project-vue' ||
          projectType === 'teleport-project-nuxt'
        ) {
          // Strip pre-escaped backticks (\` → `) for HTML/template frameworks.
          // In these contexts backticks are just regular characters and the
          // escaping would be a JavaScript syntax error inside <script> tags.
          rawHtmlContent = rawHtmlContent.replace(/\\`/g, '`')
        }
        // Escape nested </script> tags so hast-util-from-html doesn't truncate
        // script content at an inner </script> (e.g. one inside a template literal).
        rawHtmlContent = escapeNestedScriptClose(rawHtmlContent)

        if (
          projectType === 'teleport-project-react' ||
          projectType === 'teleport-project-next'
        ) {
          // For React/Next the fork wraps script bodies in an outer {`…`}
          // template literal — make them safe for it ourselves. Parity-aware:
          // already-escaped input (the GUI mapper pre-escapes today) passes
          // through unchanged, raw input gets escaped, so this is safe on both
          // sides of the GUI dropping its pre-escape step.
          rawHtmlContent = escapeScriptBodiesForJsxTemplateLiteral(rawHtmlContent)
        }

        const hastNodes = fromHtml(rawHtmlContent, {
          fragment: true,
        })
        const content = hastToJsxOrHtml(hastNodes, { wrapper: 'fragment' })

        if (
          projectType === 'teleport-project-html' ||
          projectType === 'teleport-project-angular' ||
          projectType === 'teleport-project-vue' ||
          projectType === 'teleport-project-nuxt'
        ) {
          const node = compontnChunk.meta.nodesLookup[key] as HastNode
          if (!node) {
            return
          }
          /*
            Convert the HastNode to HastText
          */

          Object.assign(node, {
            type: 'text',
            // Restore nested </script> with <\/script> — the backslash prevents
            // the browser's HTML parser from closing the script tag prematurely,
            // and \/ evaluates to / in JavaScript at runtime.
            value: content.replace(new RegExp(SCRIPT_CLOSE_PH, 'g'), '<\\/script>'),
          })

          delete node.children
          delete node.properties
          delete dependencies['dangerous-html']
        } else {
          const node = compontnChunk.meta.nodesLookup[key] as JSXElement
          if (!node) {
            return
          }
          ;(node.openingElement.name as JSXIdentifier).name = 'React.Fragment'
          ;(node.closingElement.name as JSXIdentifier).name = 'React.Fragment'
          node.openingElement.attributes = []
          node.children.push({
            type: 'JSXText' as const,
            // Double-escape </script> for the outer template literal {`…`}:
            //   file:    <\\/script>
            //   outer `` eval:  <\/script>   (\\→\, HTML parser won't close)
            //   inner `` eval:  </script>    (\/→/, correct runtime value)
            value: content
              .replace(new RegExp(SCRIPT_CLOSE_PH, 'g'), '<\\\\/script>')
              .replace(/<\\\/script/g, '<\\\\/script'),
          } as JSXText)
        }
      }
    })

    return structure
  }

  return componentPlugin
}
