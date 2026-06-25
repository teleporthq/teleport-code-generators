import { UIDLStyleSetDefinition } from '@teleporthq/teleport-types'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { sanitizeStylesheetSelectors } from '../src/utils'
import { createStyleSheetPlugin } from '../src/style-sheet'
import { setUpStructureWithHASTChunk } from './mocks'

// A stray `)` in a CSS selector makes the production cssnano selector parser throw
// "Expected an opening parenthesis", failing the consumer's whole `next build`,
// even though `next dev` silently tolerates it. The generated stylesheet must
// therefore never ship a selector with unbalanced parentheses.
describe('sanitizeStylesheetSelectors', () => {
  it('drops an unmatched closing paren in a selector', () => {
    expect(sanitizeStylesheetSelectors('.foo) { color: red }')).toBe('.foo { color: red }')
    expect(sanitizeStylesheetSelectors('.a:hover) { color: red }')).toBe('.a:hover { color: red }')
    expect(sanitizeStylesheetSelectors('.a:not(.b)) { color: red }')).toBe(
      '.a:not(.b) { color: red }'
    )
  })

  it('closes an unmatched opening paren in a selector', () => {
    expect(sanitizeStylesheetSelectors('.a:not(.b { color: red }')).toBe(
      '.a:not(.b ){ color: red }'
    )
  })

  it('repairs selectors nested inside @media blocks', () => {
    expect(sanitizeStylesheetSelectors('@media (max-width: 768px) { .x) { color: red } }')).toBe(
      '@media (max-width: 768px) { .x { color: red } }'
    )
  })

  it('leaves well-formed selectors untouched (idempotent)', () => {
    const good = [
      '.valid:nth-child(2n+1) { color: red }',
      '.ok:not(.x) .y { color: green }',
      '.btn:hover:not(:disabled) { color: blue }',
      '[data-x=")"] { color: red }',
      '@media (max-width: 991px) { .a { color: red } }',
    ]
    good.forEach((css) => {
      expect(sanitizeStylesheetSelectors(css)).toBe(css)
      expect(sanitizeStylesheetSelectors(sanitizeStylesheetSelectors(css))).toBe(css)
    })
  })
})

describe('plugin-css emits balanced selectors', () => {
  it('repairs a malformed subselector so the stylesheet has no stray paren', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setUpStructureWithHASTChunk()
    const styleSetDefinitions: Record<string, UIDLStyleSetDefinition> = {
      cardId: {
        type: 'reusable-project-style-map',
        content: { color: staticNode('red') },
        className: 'card',
        // Stray `)` in the (unescaped) subselector — an AI-authored typo that
        // would otherwise ship `.card:hover:not(.x)) { … }` and break cssnano.
        subselectors: ':hover:not(.x))',
      },
    }
    structure.uidl = { ...structure.uidl, styleSetDefinitions }

    const { chunks } = await plugin(structure)
    const { content } = chunks.find((chunk) => chunk.fileType === 'css')

    expect(content).toContain('.card:hover:not(.x)')
    expect(content).not.toMatch(/:not\(\.x\)\)/)
  })
})
