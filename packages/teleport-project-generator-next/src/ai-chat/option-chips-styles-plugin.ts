import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { findChatStyleTemplate, isChatComponent } from './style-template-utils'

/**
 * Styles the assistant's clickable answer chips by STATE.
 *
 * A chip is an ordinary UIDL button, so its base look (padding, radius,
 * border) comes through node styles as usual. What node styles cannot express
 * is "how does it look once it has been picked, or once the conversation has
 * moved past it" — that lives in a `data-option-state` attribute the chat's own
 * scripts write, so the rules have to be appended to the component's
 * `<style jsx>` block here.
 *
 * ⛔ Unlike the markdown rules, these are NOT wrapped in `:global(...)`. The
 * chips are lowercase `<button>` elements in the component's own JSX, so
 * styled-jsx does add its scope class to them — going global would leak three
 * attribute selectors into every page that renders the chat for no reason. (The
 * markdown case is different: its children are created at runtime by a
 * capitalized component and never carry the hash.)
 */

/** Matches the generated class of an option-chip button. */
const OPTION_CHIP_CLASS_RE = /\.([A-Za-z0-9_-]*option-chip[A-Za-z0-9_-]*)/g

const buildOptionChipCss = (chipClasses: string[]): string => {
  const each = (suffix: string) => chipClasses.map((cls) => `.${cls}${suffix}`).join(',\n')
  return [
    '',
    // The choice the visitor took stays visible after the fact, so the
    // transcript still reads as a conversation rather than a list of dead
    // buttons.
    `${each("[data-option-state='selected']")} {`,
    '  background: var(--color-primary, #3b82f6);',
    '  color: var(--color-on-primary, #ffffff);',
    '  border-color: var(--color-primary, #3b82f6);',
    '}',
    // Everything the visitor did not pick, and every option from an older
    // question: still readable, clearly no longer offered.
    `${each("[data-option-state='inactive']")} {`,
    '  opacity: 0.5;',
    '}',
    `${each(':disabled')} {`,
    '  cursor: default;',
    '}',
    // Only a live chip reacts to the pointer.
    `${each(':not(:disabled):hover')} {`,
    '  border-color: var(--color-primary, #3b82f6);',
    '  color: var(--color-primary, #3b82f6);',
    '}',
    '',
  ].join('\n')
}

const collectChipClasses = (template: types.TemplateLiteral): string[] => {
  const classes = new Set<string>()
  template.quasis.forEach((quasi) => {
    const raw = quasi.value.raw || ''
    let match = OPTION_CHIP_CLASS_RE.exec(raw)
    while (match !== null) {
      classes.add(match[1])
      match = OPTION_CHIP_CLASS_RE.exec(raw)
    }
    OPTION_CHIP_CLASS_RE.lastIndex = 0
  })
  return Array.from(classes)
}

export const createAIChatOptionChipsStylesPlugin: ComponentPluginFactory<
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

    const chipClasses = collectChipClasses(template)
    // A chat activated before option chips existed simply has no such class.
    if (chipClasses.length === 0) {
      return structure
    }

    const css = buildOptionChipCss(chipClasses)
    const lastQuasi = template.quasis[template.quasis.length - 1]
    lastQuasi.value.raw = (lastQuasi.value.raw || '') + css
    lastQuasi.value.cooked = (lastQuasi.value.cooked || '') + css

    return structure
  }

  return plugin
}
