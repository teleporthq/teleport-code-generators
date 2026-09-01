import * as types from '@babel/types'

/**
 * Finding the AI chat component's own `<style jsx>` block so a plugin can append
 * rules the UIDL cannot express.
 *
 * UIDL styles are strictly per-node, so anything involving a descendant, a
 * pseudo-class, or an attribute selector has to be appended to the compiled
 * template literal instead. Both the markdown rules and the option-chip state
 * rules need exactly that, so the search lives here rather than being copied.
 */

export { isChatComponent } from './ast-utils'

/**
 * The chat's styled-jsx template literal, identified by a class its CSS
 * mentions.
 *
 * A component can emit several `<style jsx>` blocks, so the caller passes the
 * pattern that identifies the right one — matching on content rather than
 * position keeps this working when the chat's markup is reordered.
 */
export const findChatStyleTemplateBy = (
  node: types.Node | null | undefined,
  matches: (css: string) => boolean
): types.TemplateLiteral | null => {
  if (!node || typeof node !== 'object') {
    return null
  }
  if (types.isJSXElement(node)) {
    const opening = node.openingElement
    if (types.isJSXIdentifier(opening.name) && opening.name.name === 'style') {
      for (const child of node.children) {
        if (
          types.isJSXExpressionContainer(child) &&
          types.isTemplateLiteral(child.expression) &&
          child.expression.quasis.some((quasi) => matches(quasi.value.raw || ''))
        ) {
          return child.expression
        }
      }
      return null
    }
  }
  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findChatStyleTemplateBy(entry as types.Node, matches)
        if (found) {
          return found
        }
      }
    } else if (value && typeof value === 'object' && 'type' in (value as object)) {
      const found = findChatStyleTemplateBy(value as types.Node, matches)
      if (found) {
        return found
      }
    }
  }
  return null
}

/** Matches the generated class of the AI bubble's markdown element. */
export const AI_MESSAGE_CLASS_RE = /\.([A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]*)/

/**
 * The chat's main style block. Located by the AI-message class because that is
 * the one class every activated chat has carried since the component existed.
 */
export const findChatStyleTemplate = (
  node: types.Node | null | undefined
): types.TemplateLiteral | null =>
  findChatStyleTemplateBy(node, (css) => AI_MESSAGE_CLASS_RE.test(css))
