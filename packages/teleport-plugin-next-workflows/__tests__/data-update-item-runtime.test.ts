import { loadHandler, HandlerFn } from './_helpers/load-handler'

// Regression guards for the data-update-item runtime output contract (run
// d9a24741):
//  - the gate `if (updateNode.affected > 0)` read `undefined` because the
//    handler only returned `updatedCount` → every successful edit fell to its
//    "record may have been deleted" branch. The handler now aliases `affected`.
//  - an un-prefilled form field is OMITTED by general-extract-form-data, so its
//    columnMapping value resolves to `undefined`; sending it wrote NULL into a
//    NOT-NULL column (`guests.full_name`). The handler now omits undefined
//    columnMappings so the column keeps its stored value.

type FetchCall = { url: string; body: Record<string, unknown> }

function installFetch(response: Record<string, unknown>, ok = true): FetchCall[] {
  const calls: FetchCall[] = []
  ;(globalThis as any).fetch = async (url: string, opts: { body: string }) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok, json: async () => response }
  }
  return calls
}

function uninstallFetch(): void {
  delete (globalThis as any).fetch
}

describe('data-update-item runtime output + null-safety', () => {
  let handler: HandlerFn

  beforeAll(() => {
    handler = loadHandler('data-update-item')
  })

  afterEach(() => {
    uninstallFetch()
  })

  it('aliases `affected` to `updatedCount` on a successful update', async () => {
    installFetch({ id: 'r1', updatedCount: 1, item: { id: 'r1' } })
    const result = (await handler(
      {
        tableName: 'events',
        filters: [{ field: 'id', operator: '=', value: 'e1' }],
        columnMappings: [{ column: 'title', value: 'New title' }],
      },
      {}
    )) as Record<string, unknown>
    expect(result.updatedCount).toBe(1)
    expect(result.affected).toBe(1)
  })

  it('reports affected:0 on the no-op (unresolved route-param) degrade', async () => {
    const result = (await handler(
      {
        tableName: 'events',
        filters: [{ field: 'id', operator: '=', value: '__TQ_UNRESOLVED_ROUTE_PARAM__' }],
        columnMappings: [{ column: 'title', value: 'x' }],
      },
      {}
    )) as Record<string, unknown>
    expect(result.updatedCount).toBe(0)
    expect(result.affected).toBe(0)
  })

  it('omits an undefined-resolving columnMapping so it never writes NULL', async () => {
    const calls = installFetch({ id: 'r1', updatedCount: 1 })
    await handler(
      {
        tableName: 'guests',
        filters: [{ field: 'id', operator: '=', value: 'g1' }],
        columnMappings: [
          { column: 'full_name', value: undefined },
          { column: 'phone', value: '555-1234' },
        ],
      },
      {}
    )
    expect(calls).toHaveLength(1)
    const sentMappings = calls[0].body.columnMappings as Array<{ column: string }>
    expect(sentMappings.map((m) => m.column)).toEqual(['phone'])
  })

  it('never sends an empty UPDATE when every columnMapping is undefined', async () => {
    const calls = installFetch({ id: 'r1', updatedCount: 1 })
    const result = (await handler(
      {
        tableName: 'guests',
        filters: [{ field: 'id', operator: '=', value: 'g1' }],
        columnMappings: [
          { column: 'full_name', value: undefined },
          { column: 'phone', value: undefined },
        ],
      },
      {}
    )) as Record<string, unknown>
    expect(calls).toHaveLength(0)
    expect(result.updatedCount).toBe(0)
    expect(result.affected).toBe(0)
  })

  it('preserves an explicit null columnMapping (intentional clear ≠ undefined)', async () => {
    const calls = installFetch({ id: 'r1', updatedCount: 1 })
    await handler(
      {
        tableName: 'guests',
        filters: [{ field: 'id', operator: '=', value: 'g1' }],
        columnMappings: [{ column: 'notes', value: null }],
      },
      {}
    )
    expect(calls).toHaveLength(1)
    const sentMappings = calls[0].body.columnMappings as Array<{ column: string; value: unknown }>
    expect(sentMappings).toEqual([{ column: 'notes', value: null }])
  })
})
