import { generateSharedRuntimeUtilsCode } from '../src'
import { loadHandler } from './_helpers/load-handler'

// Regression guard for the literal {{...}} template tokens that deployed
// node configs carry into the generated runtime (FurniFlow run be21af83):
// {{urlDifferentiator}} / {{Current Page Entity.id}} / {{page.entityId}}
// (details-page route param), {{state.X}} (trigger-time state snapshot) and
// {{Current User.id}} (GlobalContext bridge). No other substitution site
// exists in the generated app, so before this fix the literal token text
// reached SQL — breaking every edit/delete/save workflow on details pages.

const SENTINEL = '__TQ_UNRESOLVED_ROUTE_PARAM__'

type SharedUtils = {
  resolveConfig: (cfg: unknown, ctx: Record<string, unknown>) => any
  resolveTemplateTokenString: (
    value: unknown,
    ctx: Record<string, unknown>
  ) => { matched: boolean; value?: unknown }
  finalizeResolvedConfig: (nodeType: string, cfg: unknown) => string | null
  executeNodes: (
    nodes: unknown[],
    edges: unknown[],
    ctx: Record<string, unknown>,
    handlers: Record<string, unknown>,
    workflowConfig: Record<string, unknown>
  ) => Promise<void>
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

describe('workflow runtime template-token resolution', () => {
  const utils = loadSharedRuntime()

  describe('{{state.X}}', () => {
    it('resolves from the trigger-time state snapshot', () => {
      const ctx = { __stateValues: { searchQuery: 'oak desk' } }
      const resolved = utils.resolveConfig(
        { filters: [{ field: 'name', value: '{{state.searchQuery}}', operator: 'ILIKE' }] },
        ctx
      )
      expect(resolved.filters[0].value).toBe('oak desk')
    })

    it('resolves nested paths and degrades a missing state to null', () => {
      const ctx = { __stateValues: { form: { qty: 3 } } }
      expect(utils.resolveTemplateTokenString('{{state.form.qty}}', ctx)).toEqual({
        matched: true,
        value: 3,
      })
      expect(utils.resolveTemplateTokenString('{{state.missing}}', ctx)).toEqual({
        matched: true,
        value: null,
      })
    })

    it('does NOT touch JS-expression tokens (ternaries etc.)', () => {
      const ternary = "{{state.categorySelect === 'All' ? undefined : state.categorySelect}}"
      expect(utils.resolveTemplateTokenString(ternary, {}).matched).toBe(false)
    })
  })

  describe('{{urlDifferentiator}} / {{Current Page Entity.id}} / {{page.entityId}}', () => {
    const routeCtx = {
      __routeParams: { id: 'b8b7e9aa-1111-4222-8333-abcdefabcdef' },
      __dynamicRouteParam: 'id',
    }

    it.each(['{{urlDifferentiator}}', '{{Current Page Entity.id}}', '{{page.entityId}}'])(
      'resolves %s to the dynamic-route param value',
      (token) => {
        const resolved = utils.resolveConfig(
          { filters: [{ field: 'id', value: token, operator: '=' }] },
          routeCtx
        )
        expect(resolved.filters[0].value).toBe('b8b7e9aa-1111-4222-8333-abcdefabcdef')
      }
    )

    it('falls back to the "id" param when no __dynamicRouteParam is declared', () => {
      const ctx = { __routeParams: { id: 'abc-123' } }
      expect(utils.resolveTemplateTokenString('{{urlDifferentiator}}', ctx)).toEqual({
        matched: true,
        value: 'abc-123',
      })
    })

    it('resolves to the sentinel on a page with no route params', () => {
      expect(utils.resolveTemplateTokenString('{{Current Page Entity.id}}', {})).toEqual({
        matched: true,
        value: SENTINEL,
      })
    })
  })

  describe('{{Current User.id}}', () => {
    it('resolves from the GlobalContext-bridged currentUser', () => {
      const ctx = { __stateValues: { currentUser: { id: 'user-42', email: 'a@b.c' } } }
      const resolved = utils.resolveConfig(
        { columnMappings: [{ column: 'created_by_user_id', value: '{{Current User.id}}' }] },
        ctx
      )
      expect(resolved.columnMappings[0].value).toBe('user-42')
    })

    it('resolves to null when no session exists', () => {
      expect(utils.resolveTemplateTokenString('{{Current User.id}}', {})).toEqual({
        matched: true,
        value: null,
      })
    })
  })

  describe('finalizeResolvedConfig', () => {
    it('turns an unresolved route param in a data-node filter into a validation error', () => {
      const cfg = { filters: [{ field: 'id', value: SENTINEL, operator: '=' }] }
      const error = utils.finalizeResolvedConfig('data-select', cfg)
      expect(error).toContain('id')
      expect(error).toContain('not available')
      expect(cfg.filters[0].value).toBeNull()
    })

    it('degrades an unresolved route param outside filters to null without erroring', () => {
      const cfg = { columnMappings: [{ column: 'product_id', value: SENTINEL }] }
      expect(utils.finalizeResolvedConfig('data-create-item', cfg)).toBeNull()
      expect(cfg.columnMappings[0].value).toBeNull()
    })

    it('leaves configs without sentinels untouched', () => {
      const cfg = { filters: [{ field: 'id', value: null, operator: '=' }] }
      expect(utils.finalizeResolvedConfig('data-select', cfg)).toBeNull()
      expect(cfg.filters[0].value).toBeNull()
    })
  })

  describe('executeNodes routes the validation error to the workflow error handler', () => {
    it('throws (→ error handler) instead of calling the data handler with the literal', async () => {
      const handlerCalls: unknown[] = []
      const handlers = {
        'data-select': async (cfg: unknown) => {
          handlerCalls.push(cfg)
          return { rows: [] }
        },
      }
      const nodes = [
        {
          id: 'fetch-product-data',
          type: 'data-select',
          stepNumber: 1,
          config: {
            tableName: 'products',
            filters: [{ field: 'id', value: '{{urlDifferentiator}}', operator: '=' }],
          },
        },
      ]
      // No route params in context → the token resolves to the sentinel.
      await expect(
        utils.executeNodes(nodes, [], {}, handlers, { triggerNodeId: 't' })
      ).rejects.toThrow(/not available/)
      expect(handlerCalls).toHaveLength(0)
    })
  })

  describe('generated data-node handlers reject the sentinel defensively', () => {
    // The API-route segment executor resolves configs without the
    // executeNodes finalize pass, so the handlers themselves must catch a
    // sentinel that slipped through — degrade to empty/no-op without `error`
    // so the workflow is not aborted.
    it('data-select returns empty rows for a sentinel filter', async () => {
      const handler = loadHandler('data-select')
      const result = (await handler(
        { tableName: 'products', filters: [{ field: 'id', value: SENTINEL, operator: '=' }] },
        {}
      )) as { rows: unknown[]; error?: string; __skippedUnavailableFilter?: boolean }
      expect(result.error).toBeUndefined()
      expect(result.rows).toEqual([])
      expect(result.__skippedUnavailableFilter).toBe(true)
    })

    it('data-update-item no-ops for a sentinel filter', async () => {
      const handler = loadHandler('data-update-item')
      const result = (await handler(
        {
          tableName: 'products',
          filters: [{ field: 'id', value: SENTINEL, operator: '=' }],
          columnMappings: [{ column: 'name', value: 'X' }],
        },
        {}
      )) as { updatedCount: number; error?: string; __skippedUnavailableFilter?: boolean }
      expect(result.error).toBeUndefined()
      expect(result.updatedCount).toBe(0)
      expect(result.__skippedUnavailableFilter).toBe(true)
    })

    it('data-create-item nulls sentinel columnMappings so the INSERT survives', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        json: async () => ({ id: 'new-id', item: { id: 'new-id' } }),
      }))
      const originalFetch = (globalThis as any).fetch
      ;(globalThis as any).fetch = fetchMock
      try {
        const handler = loadHandler('data-create-item')
        const result = await handler(
          {
            tableName: 'stock_movements',
            columnMappings: [
              { column: 'movement_type', value: 'receipt' },
              { column: 'product_id', value: SENTINEL },
            ],
          },
          {}
        )
        expect(result.id).toBe('new-id')
        const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body)
        expect(body.columnMappings[1].value).toBeNull()
      } finally {
        ;(globalThis as any).fetch = originalFetch
      }
    })
  })
})
