import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import {
  makeMultiMapperUidl,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

type ControlOptions = Parameters<typeof makeWidgetComponentChunk>[0]

/**
 * A page's OWN search box, marked `data-tq-search-for` with its mapper's node
 * id, is wired like the platform's `search-input`: controlled by the mapper's
 * query state. It is paired by the id it names, never by its place among the
 * platform inputs.
 */

const runPlugin = async (
  repeaters: RepeaterOptions[],
  controls: ControlOptions
): Promise<string> => {
  const chunk = makeWidgetComponentChunk(controls)
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeMultiMapperUidl(repeaters) },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code
}

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

const wiredTo = (index: number): string =>
  `onChange={e => setDs_${index}_searchQuery(e.target.value)} value={ds_${index}_searchQuery}`

describe('pagination plugin — a page’s own search box', () => {
  it('controls a marked input by the query of the mapper it names, and keeps Enter from submitting', async () => {
    const flat = collapse(
      await runPlugin([{ searchEnabled: true, nodeId: 'TQ_orders' }], {
        controls: ['previous', 'next'],
        standaloneSearch: [{ name: 'hm-search', forNodeId: 'TQ_orders' }],
      })
    )
    expect(flat).toContain(`name="hm-search" data-tq-search-for="TQ_orders" ${wiredTo(0)}`)
    expect(flat).toContain('onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}')
  })

  it('pairs by the id named, whatever the order: the platform input keeps its place', async () => {
    const flat = collapse(
      await runPlugin(
        [
          { searchEnabled: true, nodeId: 'TQ_jobs' },
          { searchEnabled: true, nodeId: 'TQ_orders' },
        ],
        {
          controls: ['previous', 'next'],
          mappers: 2,
          standaloneSearch: [
            { name: 'hm-search', forNodeId: 'TQ_orders' },
            { name: 'platform-search' },
          ],
        }
      )
    )
    // The marked box searches the second mapper; the platform box, first of its kind, the first.
    expect(flat).toContain(`data-tq-search-for="TQ_orders" ${wiredTo(1)}`)
    expect(flat).toContain(
      `name="platform-search" className="products-list-search-input" ${wiredTo(0)}`
    )
  })

  it('leaves a marked input alone when no search-enabled mapper carries its id', async () => {
    const flat = collapse(
      await runPlugin([{ searchEnabled: true, nodeId: 'TQ_orders' }], {
        controls: ['previous', 'next'],
        standaloneSearch: [{ name: 'hm-search', forNodeId: 'TQ_elsewhere' }],
      })
    )
    expect(flat).toContain('name="hm-search" data-tq-search-for="TQ_elsewhere" />')
    expect(flat).not.toContain('setDs_0_searchQuery(e.target.value)')
  })
})
