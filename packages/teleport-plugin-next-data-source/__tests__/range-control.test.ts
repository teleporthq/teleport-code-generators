import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import {
  makeUidlNode,
  makeWidgetComponentChunk,
  RANGE_DRAWN_TEXT,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

type ControlOptions = Parameters<typeof makeWidgetComponentChunk>[0]

const runPlugin = async (repeater: RepeaterOptions, controls: ControlOptions): Promise<string> => {
  const chunk = makeWidgetComponentChunk(controls)
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeUidlNode(repeater) },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code
}

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

const TOTAL_STATE = 'const [ds_0_total, setDs_0_total] = useState(null)'
const DRAWN = `ds_0_total === null ? "${RANGE_DRAWN_TEXT}" :`
const FROM_BY_PAGE = '(ds_0_total === 0 ? 0 : (ds_0_page - 1) * 20 + 1).toLocaleString("en-US")'
const FROM_FIRST_ROW = '(ds_0_total === 0 ? 0 : 1).toLocaleString("en-US")'
const TO = 'Math.min(ds_0_page * 20, ds_0_total).toLocaleString("en-US")'
const TOTAL = 'ds_0_total.toLocaleString("en-US")'
const PAGE = 'ds_0_page.toLocaleString("en-US")'
const PAGES = '(ds_0_total === 0 ? 0 : Math.max(1, ds_0_maxPages)).toLocaleString("en-US")'
const PER_PAGE = '(20).toLocaleString("en-US")'

describe('pagination plugin — range control', () => {
  it('fills the authored words with the page window in buttons mode', async () => {
    const flat = collapse(await runPlugin({}, { controls: ['previous', 'range', 'next'] }))

    // The total is a state of its own — `maxPages` cannot give it back — and
    // the count effect fills both from the same response.
    expect(flat).toContain(TOTAL_STATE)
    expect(flat).toContain('setDs_0_maxPages(')
    expect(flat).toContain('setDs_0_total(data.count)')

    // The drawn text stays until the count has answered; then the template.
    expect(flat).toContain(`${DRAWN} \`Showing \${${FROM_BY_PAGE}}–\${${TO}} of \${${TOTAL}}\``)
    // The marker and template ride along, so the DOM carries the contract.
    expect(flat).toContain('data-tq-pagination-control="range"')
    expect(flat).toContain('data-tq-range-template=')
  })

  it('counts from the first row in an appending list and survives the mode pruning', async () => {
    const flat = collapse(
      await runPlugin(
        { infiniteScroll: true, infiniteScrollLoadMore: true },
        { controls: ['previous', 'range', 'load-more', 'next'] }
      )
    )

    // Previous/Next are pruned for an appending list; the range is not.
    expect(flat).not.toContain('thq-previous-elm')
    expect(flat).not.toContain('thq-next-elm')
    expect(flat).toContain('thq-load-more-elm')
    expect(flat).toContain('data-tq-pagination-control="range"')

    // Everything loaded so far: 1 .. min(pages × perPage, total).
    expect(flat).toContain(`${DRAWN} \`Showing \${${FROM_FIRST_ROW}}–\${${TO}} of \${${TOTAL}}\``)
    expect(flat).not.toContain(FROM_BY_PAGE)
  })

  it('is kept and wired beside a sentinel-driven infinite scroll too', async () => {
    const flat = collapse(await runPlugin({ infiniteScroll: true }, { controls: ['range'] }))

    expect(flat).toContain('ds_0_sentinelRef')
    expect(flat).toContain(TOTAL_STATE)
    expect(flat).toContain(FROM_FIRST_ROW)
  })

  it('survives numbered mode with the page window', async () => {
    const flat = collapse(
      await runPlugin(
        { paginationMode: 'numbered' },
        { controls: ['first', 'previous', 'pages', 'range', 'next', 'last'] }
      )
    )

    expect(flat).toContain('ds_0_pageTokens.map(token =>')
    expect(flat).toContain('data-tq-pagination-control="range"')
    expect(flat).toContain(FROM_BY_PAGE)
  })

  it('reads the page off the combined state beside a search input', async () => {
    const flat = collapse(
      await runPlugin({ searchEnabled: true }, { controls: ['previous', 'range', 'next'] })
    )

    expect(flat).toContain(TOTAL_STATE)
    expect(flat).toContain('setDs_0_total(data.count)')
    expect(flat).toContain(
      '(ds_0_total === 0 ? 0 : (ds_0_state.page - 1) * 20 + 1).toLocaleString("en-US")'
    )
    expect(flat).toContain('Math.min(ds_0_state.page * 20, ds_0_total).toLocaleString("en-US")')
  })

  it('reads the page, the page count and the page size off the mapper', async () => {
    const flat = collapse(
      await runPlugin(
        {},
        { controls: ['range'], rangeTemplate: 'Page {page} of {pages} · {perPage} per page' }
      )
    )

    // The page count is the counted `maxPages`: one page as long as there are
    // rows, none when there are none — the same words the canvas reads.
    expect(flat).toContain(
      `${DRAWN} \`Page \${${PAGE}} of \${${PAGES}} · \${${PER_PAGE}} per page\``
    )
  })

  it('reads the pages loaded so far as the page of an appending list', async () => {
    const flat = collapse(
      await runPlugin(
        { infiniteScroll: true, infiniteScrollLoadMore: true },
        { controls: ['range', 'load-more'], rangeTemplate: '{page} of {pages}' }
      )
    )

    expect(flat).toContain(`${DRAWN} \`\${${PAGE}} of \${${PAGES}}\``)
  })

  it('reads a template the JSX printer escaped the braces of', async () => {
    const flat = collapse(
      await runPlugin(
        {},
        {
          controls: ['range'],
          rangeTemplate: 'Showing &#123;from&#125;–&#123;to&#125; of &#123;total&#125;',
        }
      )
    )
    expect(flat).not.toContain('`Showing &#123;')
    expect(flat).toMatch(/`Showing \$\{[^`]*–\$\{[^`]*of \$\{[^`]*`/)
  })

  it('falls back to "{from}–{to} of {total}" when no template is authored', async () => {
    const flat = collapse(await runPlugin({}, { controls: ['range'], rangeTemplate: null }))

    expect(flat).not.toContain('data-tq-range-template')
    expect(flat).toContain(`${DRAWN} \`\${${FROM_BY_PAGE}}–\${${TO}} of \${${TOTAL}}\``)
  })

  it('wires a range outside every widget to the mapper it names, wherever it sits', async () => {
    // Placed BEFORE the provider — a toolbar above the list — so the
    // container-ownership rule could never have reached it.
    const flat = collapse(
      await runPlugin(
        { nodeId: 'mapper-1' },
        { controls: ['previous', 'next'], standaloneRange: { forNodeId: 'mapper-1' } }
      )
    )

    expect(flat).toContain('data-tq-pagination-for="mapper-1"')
    expect(flat).toContain(TOTAL_STATE)
    expect(flat).toContain(`${DRAWN} \`Showing \${${FROM_BY_PAGE}}–\${${TO}} of \${${TOTAL}}\``)
  })

  it('leaves a range naming a mapper this component does not render as drawn', async () => {
    const flat = collapse(
      await runPlugin(
        { nodeId: 'mapper-1' },
        { controls: ['previous', 'next'], standaloneRange: { forNodeId: 'someone-else' } }
      )
    )

    expect(flat).toContain(`>${RANGE_DRAWN_TEXT}</div>`)
    expect(flat).not.toContain('ds_0_total === null')
  })

  it('changes nothing for a component without a range control', async () => {
    const flat = collapse(await runPlugin({}, { controls: ['previous', 'next'] }))

    expect(flat).not.toContain('ds_0_total')
    expect(flat).not.toContain('setDs_0_total')
  })
})
