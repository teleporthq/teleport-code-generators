import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import {
  makeMultiMapperUidl,
  makeUidlNode,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

const runPlugin = async (
  repeater: RepeaterOptions,
  controls: string[] = ['previous', 'next']
): Promise<string> => {
  const chunk = makeWidgetComponentChunk({ controls })
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

describe('pagination plugin — infinite scroll', () => {
  it('accumulates pages inside fetchData and reports the end of the data', async () => {
    const code = await runPlugin({ infiniteScroll: true })
    const flat = collapse(code)

    expect(flat).toContain('const ds_0_accumRef = useRef({ sig: "", pages: {} })')
    expect(flat).toContain('const [ds_0_hasMoreFlag, setDs_0_hasMoreFlag] = useState(true)')
    // Two independent end-of-data signals: a short page, and the counted total.
    expect(flat).toContain(
      'const ds_0_hasMore = ds_0_hasMoreFlag && (ds_0_maxPages === 0 || ds_0_page < ds_0_maxPages)'
    )

    // Everything but the page identifies the QUERY: a filter, sort or search
    // change must start a fresh list rather than interleave two result sets.
    expect(flat).toContain('const sig = JSON.stringify({ ...params, page: 0 })')
    expect(flat).toContain('if (ds_0_accumRef.current.sig !== sig)')
    expect(flat).toContain('ds_0_accumRef.current = { sig, pages: {} }')
    expect(flat).toContain('ds_0_accumRef.current.pages[page] = rows')
    // A short page is the only end signal a source that cannot count gives.
    expect(flat).toContain('setDs_0_hasMoreFlag(rows.length >= 20)')
    // Numeric sort, so page 10 does not land between 1 and 2.
    expect(flat).toContain('.map(Number).sort((a, b) => a - b).reduce(')
  })

  it('keeps the page out of the provider key and suppresses initialData', async () => {
    const code = await runPlugin({ infiniteScroll: true })

    // Remounting per appended page would throw away the accumulated rows...
    expect(code).not.toContain('ds_0_page}`')
    // ...and initialData would make DataProvider skip the fetch that fills the
    // accumulator with page 1.
    expect(code).not.toContain('initialData')
  })

  it('observes a sentinel after the list when there is no Load More button', async () => {
    const code = await runPlugin({ infiniteScroll: true })
    const flat = collapse(code)

    expect(flat).toContain('const ds_0_sentinelRef = useRef(null)')
    expect(flat).toContain(
      '<div ref={ds_0_sentinelRef} aria-hidden="true" style={{ height: "1px" }} />'
    )
    expect(flat).toContain('new IntersectionObserver(')
    expect(flat).toContain('typeof IntersectionObserver === "undefined"')
    expect(flat).toContain('rootMargin: "200px"')
    expect(flat).toContain('return () => observer.disconnect()')
    expect(flat).toContain('}, [ds_0_hasMore, ds_0_maxPages])')
    // ⛔ The next page comes from the updater's OWN argument. The effect is
    // re-armed on hasMore/maxPages, neither of which changes on an append while
    // the total is unknown — a captured page would still read 1 on the second
    // intersection and the list would stop growing after one page.
    expect(flat).toContain(
      'setDs_0_page(page => ds_0_maxPages > 0 && page >= ds_0_maxPages ? page : page + 1)'
    )
  })

  it('wires the authored Load More button instead, with no observer', async () => {
    const code = await runPlugin({ infiniteScroll: true, infiniteScrollLoadMore: true }, [
      'load-more',
    ])
    const flat = collapse(code)

    expect(flat).toContain('className="thq-load-more-elm"')
    expect(flat).toContain('type="button"')
    expect(flat).toContain('disabled={!ds_0_hasMore}')
    expect(flat).not.toContain('IntersectionObserver')
    expect(flat).not.toContain('sentinelRef')
  })

  it('drops page controls left in the widget when the list appends', async () => {
    const code = await runPlugin({ infiniteScroll: true, infiniteScrollLoadMore: true }, [
      'previous',
      'load-more',
      'next',
    ])

    // A visitor of an appending list never leaves page 1, so Previous/Next
    // would be dead controls.
    expect(code).not.toContain('thq-previous-elm')
    expect(code).not.toContain('thq-next-elm')
    expect(code).toContain('thq-load-more-elm')
  })

  it('strips a widget left behind on an auto-loading list', async () => {
    // An older project (or an externally placed widget) can still carry
    // Previous/Next after the author switches to infinite scroll. They would be
    // dead controls, so the mode's own pruning removes them even though this
    // mapper renders no widget of its own.
    const code = await runPlugin({ infiniteScroll: true }, ['previous', 'next'])

    expect(code).not.toContain('thq-previous-elm')
    expect(code).not.toContain('thq-next-elm')
  })

  it('does not desynchronise the widget zip when mappers use different modes', async () => {
    // ⛔ The infinite mapper draws no container. Counting one for it would wire
    // THIS mapper's buttons to the other mapper's state.
    const chunk = makeWidgetComponentChunk({ controls: ['previous', 'next'], mappers: 1 })
    const structure: ComponentStructure = {
      uidl: {
        name: 'TestComponent',
        node: makeMultiMapperUidl([{ infiniteScroll: true }, {}]),
      },
      chunks: [chunk],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    await createNextArrayMapperPaginationPlugin()(structure)
    const code = generator(chunk.content as types.Node).code

    // The single authored widget belongs to the SECOND (paginated) mapper.
    expect(code).toContain('setDs_1_page')
    expect(code).not.toContain('setDs_0_page(page => Math.max(1, page - 1))')
  })
})
