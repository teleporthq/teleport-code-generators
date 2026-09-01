import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import {
  makeUidlNode,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

const runPlugin = async (
  repeater: RepeaterOptions,
  controls: string[],
  legacyOnly = false
): Promise<string> => {
  const chunk = makeWidgetComponentChunk({ controls, legacyOnly })
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

const NUMBERED_CONTROLS = ['first', 'previous', 'pages', 'next', 'last']

describe('pagination plugin — numbered mode', () => {
  it('computes a windowed token list with an ellipsis on each side', async () => {
    const code = await runPlugin({ paginationMode: 'numbered' }, NUMBERED_CONTROLS)
    const flat = collapse(code)

    expect(flat).toContain('const ds_0_pageTokens = useMemo(')
    // No results at all and a single page are answered without a window.
    expect(flat).toContain('if (total <= 0) return []')
    expect(flat).toContain('if (total === 1) return [1]')
    // First and last are always shown, with one neighbour either side.
    expect(flat).toContain('const start = Math.max(2, current - 1)')
    expect(flat).toContain('const end = Math.min(total - 1, current + 1)')
    expect(flat).toContain('if (start > 2) tokens.push("start-ellipsis")')
    expect(flat).toContain('if (end < total - 1) tokens.push("end-ellipsis")')
    expect(flat).toContain('}, [ds_0_maxPages, ds_0_page])')
  })

  it('repeats the authored template button per page, preserving its class', async () => {
    const code = await runPlugin({ paginationMode: 'numbered' }, NUMBERED_CONTROLS)
    const flat = collapse(code)

    expect(flat).toContain('ds_0_pageTokens.map(token =>')
    expect(flat).toContain('typeof token === "number"')
    // The author's own node is cloned, so their styling survives.
    expect(flat).toContain('className="thq-page-elm"')
    // The current page is MARKED, not disabled — it stays reachable and
    // `[aria-current='page']` is styleable.
    expect(flat).toContain('aria-current={ds_0_page === token ? "page" : undefined}')
    // The `${token}` here is the GENERATED source being asserted on, not an
    // interpolation this file wants performed.
    // tslint:disable-next-line:no-invalid-template-strings
    expect(flat).toContain('key={`page-${token}`}')
    expect(flat).toContain('onClick={() => setDs_0_page(page => page === token ? page : token)}')
    // Whatever label the template carried is replaced by the real number.
    expect(flat).toContain('>{token}<')
    // No authored ellipsis template ⇒ a plain span fills the gap.
    expect(flat).toContain('<span key={token}>…</span>')
  })

  it('wires First and Last against the live page count', async () => {
    const code = await runPlugin({ paginationMode: 'numbered' }, NUMBERED_CONTROLS)
    const flat = collapse(code)

    expect(flat).toContain('onClick={() => setDs_0_page(page => page === 1 ? page : 1)}')
    expect(flat).toContain('disabled={ds_0_page <= 1}')
    expect(flat).toContain(
      'onClick={() => setDs_0_page(page => page === ds_0_maxPages ? page : ds_0_maxPages)}'
    )
    // maxPages 0 is "no results", where the last page would be page 0.
    expect(flat).toContain('disabled={ds_0_maxPages === 0 || ds_0_page >= ds_0_maxPages}')
  })

  it('fetches a live count on a PAGE, which otherwise only has the build-time one', async () => {
    const code = await runPlugin({ paginationMode: 'numbered' }, NUMBERED_CONTROLS)

    // A numbered strip labels every page, so a stale build-time count would
    // print numbers that do not exist.
    expect(code).toContain('-count?')
    expect(code).toContain('setDs_0_maxPages(data.count === 0 ? 0 : Math.ceil(data.count / 20))')
  })

  it('removes a numbered strip left over from a mode switch', async () => {
    // The builder never deletes controls on a mode switch (that would discard
    // the author's styling), so a Previous/Next list can still carry them.
    const code = await runPlugin({}, NUMBERED_CONTROLS)

    expect(code).not.toContain('ds_0_pageTokens')
    expect(code).not.toContain('thq-first-elm')
    expect(code).not.toContain('thq-last-elm')
    expect(code).not.toContain('thq-pages-elm')
    // Previous/Next are still wired exactly as before.
    expect(code).toContain('thq-previous-elm')
    expect(code).toContain('disabled={ds_0_page <= 1}')
  })

  it('still finds Previous/Next by class name in projects predating the marker', async () => {
    const code = await runPlugin({}, ['previous', 'next'], /* legacyOnly */ true)

    expect(code).toContain('products-list-thq-previous-elm')
    expect(code).toContain('disabled={ds_0_page <= 1}')
    expect(code).toContain('disabled={ds_0_page >= ds_0_maxPages}')
  })
})
