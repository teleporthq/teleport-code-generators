import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { AI_MESSAGE_CLASS_RE, findChatStyleTemplate, isChatComponent } from './style-template-utils'

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
 * them to the component's existing `<style jsx>` template instead.
 *
 * ⛔ THE WHOLE SELECTOR goes inside `:global(...)`, never just a part of it.
 * styled-jsx appends the scope hash to the last compound selector it considers
 * local, so of the three plausible spellings only the third survives:
 *
 *   .cls :global(ul)   →  .cls.jsx-HASH ul   ✗ the markdown ROOT has no hash
 *   :global(.cls) ul   →  .cls ul.jsx-HASH   ✗ the runtime <ul> has no hash
 *   :global(.cls ul)   →  .cls ul            ✓
 *
 * `<Markdown>` is a capitalized component, and styled-jsx only adds its class
 * to lowercase host elements — so nothing under this bubble ever carries the
 * hash, and any rule that keeps one is silently dead. The class itself is
 * component-prefixed and unique, so going fully global leaks nothing.
 */

const buildMarkdownCss = (messageClass: string): string => {
  const scope = (selector: string) => `:global(.${messageClass} ${selector})`
  return [
    '',
    `${scope('p')} {`,
    '  margin: 0 0 8px;',
    '}',
    // The bubble supplies its own padding; the first and last blocks must not
    // add to it, or every answer sits crooked inside its bubble.
    `${scope('> *:first-child')} {`,
    '  margin-top: 0;',
    '}',
    `${scope('> *:last-child')} {`,
    '  margin-bottom: 0;',
    '}',
    `${scope('a')} {`,
    '  color: inherit;',
    '  font-weight: 600;',
    '  text-decoration: underline;',
    '  text-underline-offset: 2px;',
    '}',
    `${scope('ul')},`,
    `${scope('ol')} {`,
    '  margin: 8px 0;',
    '  padding-left: 20px;',
    '}',
    `${scope('ul')} {`,
    '  list-style: disc;',
    '}',
    `${scope('ol')} {`,
    '  list-style: decimal;',
    '}',
    `${scope('li')} {`,
    '  margin: 4px 0;',
    '}',
    `${scope('li > ul')},`,
    `${scope('li > ol')} {`,
    '  margin: 2px 0;',
    '}',
    `${scope('li::marker')} {`,
    '  color: inherit;',
    '}',
    `${scope('strong')} {`,
    '  font-weight: 700;',
    '}',
    `${scope('em')} {`,
    '  font-style: italic;',
    '}',
    `${scope('code')} {`,
    '  font-family: monospace;',
    '  font-size: 12px;',
    '  padding: 1px 4px;',
    '  border-radius: 4px;',
    '  background: rgba(127, 127, 127, 0.15);',
    '}',
    `${scope('pre')} {`,
    '  margin: 8px 0;',
    '  padding: 8px 10px;',
    '  border-radius: 6px;',
    '  background: rgba(127, 127, 127, 0.12);',
    '  overflow-x: auto;',
    '}',
    // Otherwise the inline-code chip paints a second background inside the block.
    `${scope('pre code')} {`,
    '  padding: 0;',
    '  background: transparent;',
    '}',
    `${scope('h1')},`,
    `${scope('h2')},`,
    `${scope('h3')},`,
    `${scope('h4')} {`,
    '  font-size: 15px;',
    '  font-weight: 700;',
    '  margin: 10px 0 6px;',
    '}',
    `${scope('blockquote')} {`,
    '  margin: 8px 0;',
    '  padding-left: 10px;',
    '  border-left: 3px solid rgba(127, 127, 127, 0.4);',
    '}',
    `${scope('hr')} {`,
    '  margin: 10px 0;',
    '  border: none;',
    '  border-top: 1px solid rgba(127, 127, 127, 0.35);',
    '}',
    `${scope('table')} {`,
    '  margin: 8px 0;',
    '  border-collapse: collapse;',
    '  font-size: 13px;',
    '}',
    `${scope('th')},`,
    `${scope('td')} {`,
    '  border: 1px solid rgba(127, 127, 127, 0.35);',
    '  padding: 4px 8px;',
    '  text-align: left;',
    '}',
    '',
  ].join('\n')
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Re-scopes the bubble's OWN rule so it reaches the markdown root.
 *
 * The UIDL emits `.cls { font-size: 14px; … }`, which styled-jsx compiles to
 * `.cls.jsx-HASH` — and `<Markdown>` never gets that hash, so the bubble's
 * typography silently did nothing. Rewriting it to `:global(.cls)` is the same
 * fix as the descendant rules above.
 *
 * Idempotent: after the rewrite the class is followed by `)`, not `{`, so a
 * second pass matches nothing.
 */
const globalizeBaseRule = (raw: string, messageClass: string): string => {
  const pattern = new RegExp(`\\.${escapeRegExp(messageClass)}(?=\\s*\\{)`, 'g')
  return raw.replace(pattern, `:global(.${messageClass})`)
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

    const messageClass = classFromAnyQuasi[1]

    for (const quasi of template.quasis) {
      quasi.value.raw = globalizeBaseRule(quasi.value.raw || '', messageClass)
      if (typeof quasi.value.cooked === 'string') {
        quasi.value.cooked = globalizeBaseRule(quasi.value.cooked, messageClass)
      }
    }

    const css = buildMarkdownCss(messageClass)
    const lastQuasi = template.quasis[template.quasis.length - 1]
    lastQuasi.value.raw = (lastQuasi.value.raw || '') + css
    lastQuasi.value.cooked = (lastQuasi.value.cooked || '') + css

    return structure
  }

  return plugin
}
