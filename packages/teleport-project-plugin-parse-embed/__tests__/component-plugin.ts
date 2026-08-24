/**
 * The real hast packages are pure ESM and this repo's jest transform is CJS,
 * so the plugin-level tests mock them with minimal faithful stand-ins:
 * the fork mock reproduces hast-util-to-jsx-inline-script's script branch
 * (index.js:69 — body wrapped verbatim in an outer {`…`} with no escaping,
 * per its renderText short-circuit at :204-207), and toHtml returns the raw
 * markup the way the html target consumes it.
 */
jest.mock('hast-util-from-html', () => ({
  __esModule: true,
  fromHtml: (html: string) => ({ type: 'root', raw: html }),
}))
jest.mock('hast-util-to-jsx-inline-script', () => ({
  __esModule: true,
  default: (tree: { raw: string }) =>
    tree.raw.replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
      (_match, attrs, body) => '<Script' + attrs + '>{`' + body + '`}</Script>'
    ),
}))
jest.mock('hast-util-to-html', () => ({
  __esModule: true,
  toHtml: (tree: { raw: string }) => tree.raw,
}))

import {
  createParseEmbedPlugin,
  escapeScriptBodiesForJsxTemplateLiteral,
} from '../src/component-plugin'

describe('escapeScriptBodiesForJsxTemplateLiteral', () => {
  it('escapes raw backticks and ${ inside script bodies', () => {
    const html = '<script data-name="theme">el.setAttribute(`data-x`, `${mode}`);</script>'
    expect(escapeScriptBodiesForJsxTemplateLiteral(html)).toBe(
      '<script data-name="theme">el.setAttribute(\\`data-x\\`, \\`\\${mode}\\`);</script>'
    )
  })

  it('leaves already-escaped content unchanged (parity-aware, idempotent)', () => {
    const html = '<script>const a = \\`x\\${1}\\`;</script>'
    const once = escapeScriptBodiesForJsxTemplateLiteral(html)
    expect(once).toBe(html)
    expect(escapeScriptBodiesForJsxTemplateLiteral(once)).toBe(once)
  })

  it('escapes a raw backtick behind an escaped backslash (even parity)', () => {
    // \\` in source = literal backslash then a RAW backtick — the backtick
    // still needs its own escape; the existing backslash pair stays.
    const html = '<script>const s = "\\\\";const t = `x`;</script>'
    expect(escapeScriptBodiesForJsxTemplateLiteral(html)).toBe(
      '<script>const s = "\\\\";const t = \\`x\\`;</script>'
    )
  })

  it('does not escape bare $ (only ${ interpolates)', () => {
    const html = '<script>const price = "$5"; const re = /\\$\\d+/;</script>'
    expect(escapeScriptBodiesForJsxTemplateLiteral(html)).toBe(html)
  })

  it('touches only script bodies, never surrounding markup', () => {
    const html = '<div data-note="a ` and ${x}">text ` here</div><script>run(`ok`)</script>'
    expect(escapeScriptBodiesForJsxTemplateLiteral(html)).toBe(
      '<div data-note="a ` and ${x}">text ` here</div><script>run(\\`ok\\`)</script>'
    )
  })
})

describe('createParseEmbedPlugin — react/next script-body escaping', () => {
  const buildJsxNode = () =>
    ({
      type: 'JSXElement',
      openingElement: {
        type: 'JSXOpeningElement',
        name: { type: 'JSXIdentifier', name: 'Script' },
        attributes: [{ type: 'JSXAttribute' }],
      },
      closingElement: {
        type: 'JSXClosingElement',
        name: { type: 'JSXIdentifier', name: 'Script' },
      },
      children: [],
    } as any)

  const buildStructure = (embedContent: string, chunkName: string, node: any) =>
    ({
      uidl: {
        node: {
          type: 'element',
          content: {
            key: 'embed1',
            elementType: 'dangerous-html',
            attrs: { html: { type: 'raw', content: embedContent } },
          },
        },
      },
      chunks: [{ name: chunkName, meta: { nodesLookup: { embed1: node } } }],
      dependencies: { 'dangerous-html': {} },
      options: {},
    } as any)

  it('emits an escaped template-literal body for next (raw backtick + ${)', async () => {
    const jsxNode = buildJsxNode()
    const structure = buildStructure(
      '<script data-name="hero">const label = `hi ${name}`;</script>',
      'jsx-component',
      jsxNode
    )
    const plugin = createParseEmbedPlugin({ projectType: 'teleport-project-next' })
    await plugin(structure)

    expect(jsxNode.openingElement.name.name).toBe('React.Fragment')
    const emitted = jsxNode.children[0].value as string
    // The fork wraps the body in {`…`}; our escapes must be inside it.
    expect(emitted).toContain('{`')
    expect(emitted).toContain('const label = \\`hi \\${name}\\`;')
  })

  it('does not double-escape pre-escaped input (current GUI mapper form)', async () => {
    const jsxNode = buildJsxNode()
    const structure = buildStructure(
      '<script data-name="hero">const label = \\`hi \\${name}\\`;</script>',
      'jsx-component',
      jsxNode
    )
    const plugin = createParseEmbedPlugin({ projectType: 'teleport-project-next' })
    await plugin(structure)

    const emitted = jsxNode.children[0].value as string
    expect(emitted).toContain('const label = \\`hi \\${name}\\`;')
    expect(emitted).not.toContain('\\\\`')
  })

  it('keeps the html branch raw — backticks stay unescaped there', async () => {
    const hastNode: any = { type: 'element', tagName: 'div', properties: {}, children: [] }
    const structure = buildStructure(
      '<script data-name="hero">const label = \\`hi\\`;</script>',
      'html-chunk',
      hastNode
    )
    const plugin = createParseEmbedPlugin({ projectType: 'teleport-project-html' })
    await plugin(structure)

    expect(hastNode.type).toBe('text')
    // Line-102 unescape ran, and no re-escape happened for the html target.
    expect(hastNode.value).toContain('const label = `hi`;')
    expect(hastNode.value).not.toContain('\\`')
  })
})
