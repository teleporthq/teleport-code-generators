import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import * as types from '@babel/types'

/**
 * Styles the markdown the AI chat bubble renders.
 *
 * The assistant's replies are markdown, rendered by a `markdown-node`
 * (`markdown-to-jsx`) whose children — links, lists, bold text — are created
 * at RUNTIME. They carry no styled-jsx scope class, and a generated site's own
 * global resets (`a { text-decoration: none; color: inherit }`,
 * `ul { list-style: none }`, `p { margin: 0 }` are all common) flatten them
 * into plain-looking text, so a perfectly-formatted answer reads as if
 * markdown never happened.
 *
 * The chat component is built from UIDL nodes whose styles are strictly
 * per-node, so descendant rules cannot be expressed there. This plugin appends
 * them to the component's existing `<style jsx>` template instead, scoped
 * under the AI-message class and wrapped in `:global(...)` — without it,
 * styled-jsx would scope the descendant part to the build-time class hash the
 * runtime children never receive.
 */

/** Matches the generated class of the AI bubble's markdown element. */
const AI_MESSAGE_CLASS_RE = /\.([A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]*)/

const buildMarkdownCss = (messageClass: string): string => {
  const scope = `.${messageClass}`
  return [
    '',
    `${scope} :global(p) {`,
    '  margin: 0 0 8px;',
    '}',
    `${scope} :global(p:last-child) {`,
    '  margin-bottom: 0;',
    '}',
    `${scope} :global(a) {`,
    '  color: inherit;',
    '  font-weight: 600;',
    '  text-decoration: underline;',
    '  text-underline-offset: 2px;',
    '}',
    `${scope} :global(ul),`,
    `${scope} :global(ol) {`,
    '  margin: 8px 0;',
    '  padding-left: 20px;',
    '}',
    `${scope} :global(ul) {`,
    '  list-style: disc;',
    '}',
    `${scope} :global(ol) {`,
    '  list-style: decimal;',
    '}',
    `${scope} :global(li) {`,
    '  margin: 4px 0;',
    '}',
    `${scope} :global(strong) {`,
    '  font-weight: 700;',
    '}',
    `${scope} :global(em) {`,
    '  font-style: italic;',
    '}',
    `${scope} :global(code) {`,
    '  font-family: monospace;',
    '  font-size: 12px;',
    '  padding: 1px 4px;',
    '  border-radius: 4px;',
    '  background: rgba(127, 127, 127, 0.15);',
    '}',
    `${scope} :global(h1),`,
    `${scope} :global(h2),`,
    `${scope} :global(h3),`,
    `${scope} :global(h4) {`,
    '  font-size: 15px;',
    '  font-weight: 700;',
    '  margin: 10px 0 6px;',
    '}',
    `${scope} :global(blockquote) {`,
    '  margin: 8px 0;',
    '  padding-left: 10px;',
    '  border-left: 3px solid rgba(127, 127, 127, 0.4);',
    '}',
    '',
  ].join('\n')
}

const isChatComponent = (componentName: string): boolean => {
  return componentName.toLowerCase().replace(/[^a-z]/g, '') === 'aiassistantchat'
}

/**
 * Finds the styled-jsx template literal whose CSS text mentions the AI-message
 * class, anywhere in the node tree.
 */
const findChatStyleTemplate = (
  node: types.Node | null | undefined
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
          child.expression.quasis.some((quasi) => AI_MESSAGE_CLASS_RE.test(quasi.value.raw || ''))
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
        const found = findChatStyleTemplate(entry as types.Node)
        if (found) {
          return found
        }
      }
    } else if (value && typeof value === 'object' && 'type' in (value as object)) {
      const found = findChatStyleTemplate(value as types.Node)
      if (found) {
        return found
      }
    }
  }
  return null
}

export const createAIChatMarkdownStylesPlugin: ComponentPluginFactory<
  Record<string, never>
> = () => {
  const plugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    if (!isChatComponent(uidl.name || '')) {
      return structure
    }

    const jsxComponent = chunks.find(
      (chunk) =>
        chunk.name === 'jsx-component' &&
        typeof chunk.content === 'object' &&
        chunk.content !== null
    )
    if (!jsxComponent) {
      return structure
    }

    const template = findChatStyleTemplate(jsxComponent.content as types.Node)
    if (!template || template.quasis.length === 0) {
      return structure
    }

    const firstQuasi = template.quasis[0]
    const match = (firstQuasi.value.raw || '').match(AI_MESSAGE_CLASS_RE)
    const classFromAnyQuasi =
      match ||
      template.quasis
        .map((quasi) => (quasi.value.raw || '').match(AI_MESSAGE_CLASS_RE))
        .find(Boolean)
    if (!classFromAnyQuasi) {
      return structure
    }

    const css = buildMarkdownCss(classFromAnyQuasi[1])
    const lastQuasi = template.quasis[template.quasis.length - 1]
    lastQuasi.value.raw = (lastQuasi.value.raw || '') + css
    lastQuasi.value.cooked = (lastQuasi.value.cooked || '') + css

    return structure
  }

  return plugin
}
