import { TRACKER_SOURCE } from '../src/analytics/tracker-source'
import { TRACKER_COMPONENT_SOURCE } from '../src/analytics/tracker-component'
import { cartAddItem } from '../../teleport-plugin-next-workflows/src/nodes/cart/cart-add-item'
import { cartRemoveItem } from '../../teleport-plugin-next-workflows/src/nodes/cart/cart-remove-item'
import {
  COMMERCE_TRACKING_HELPER_SOURCE,
  assertHandlerHasNoModuleRefs,
} from '../../teleport-plugin-next-workflows/src/nodes/analytics/commerce-tracking'

/**
 * The commerce funnel a generated store reports.
 *
 * `TRACKER_SOURCE` is one long TEMPLATE LITERAL, which makes two mistakes easy
 * and both silent until a real build:
 *
 *  1. a stray backtick anywhere inside it — even in a comment — terminates the
 *     string and turns the rest of the file into broken TypeScript;
 *  2. an unescaped `${...}` becomes an interpolation, so the emitted file gets
 *     a build-time value where it expected runtime source.
 *
 * So these tests parse the emitted source rather than only grepping it.
 */

describe('commerce analytics — the emitted tracker', () => {
  it('is syntactically valid JavaScript after ES-module stripping', () => {
    // `new Function` cannot take import/export, so the module syntax is removed
    // the same way a bundler would resolve it. What remains is the code that
    // actually has to parse.
    const body = TRACKER_SOURCE.replace(/^export\s+/gm, '')
    expect(() => new Function(body)).not.toThrow()
  })

  it('carries no stray backticks or interpolations', () => {
    expect(TRACKER_SOURCE).not.toContain('`')
    // A `${` that survived into the emitted source means the template literal
    // interpolated something at build time that was meant to be runtime code.
    expect(TRACKER_SOURCE).not.toContain('${')
  })

  it('exports the commerce entry points the tracker component imports', () => {
    for (const fn of ['trackCommerceEvent', 'trackCommerceView', 'resetCommerceView']) {
      expect(TRACKER_SOURCE).toContain(`export function ${fn}`)
    }
  })

  it('accepts exactly the five funnel steps', () => {
    for (const step of [
      'view_item',
      'add_to_cart',
      'remove_from_cart',
      'begin_checkout',
      'purchase',
    ]) {
      expect(TRACKER_SOURCE).toContain(`'${step}'`)
    }
  })

  // A refreshed confirmation page must not count a second sale.
  it('dedupes purchases through a persisted ledger', () => {
    expect(TRACKER_SOURCE).toContain('tp_purchases')
    expect(TRACKER_SOURCE).toContain('claimPurchase')
  })

  // Checkout ends in a redirect that can tear the page down before the periodic
  // flush fires.
  it('flushes immediately on the two events that precede a navigation', () => {
    expect(TRACKER_SOURCE).toMatch(
      /if \(name === 'purchase' \|\| name === 'begin_checkout'\) \{\s*flush\(true\)/
    )
  })

  it('mirrors to the GA4 dataLayer independently of our own tracker', () => {
    expect(TRACKER_SOURCE).toContain('window.dataLayer')
    expect(TRACKER_SOURCE).toContain('transaction_id')
  })
})

describe('commerce analytics — the tracker component', () => {
  it('publishes the workflow-facing global', () => {
    // Workflow handlers are serialized function bodies with no module scope;
    // this global is the only channel they can reach.
    expect(TRACKER_COMPONENT_SOURCE).toContain('window.tpTrackCommerce = trackCommerceEvent')
  })

  it('re-reports the view step after a client-side navigation', () => {
    expect(TRACKER_COMPONENT_SOURCE).toContain('resetCommerceView()')
    expect(TRACKER_COMPONENT_SOURCE).toContain('trackCommerceView()')
  })

  it('carries no stray backticks', () => {
    expect(TRACKER_COMPONENT_SOURCE).not.toContain('`')
  })
})

describe('commerce analytics — the cart workflow handler', () => {
  const handler = cartAddItem.generateHandler()

  it('reports add_to_cart', () => {
    expect(handler).toContain("name: 'add_to_cart'")
  })

  // The helper cannot be imported by a serialized handler, so it has to travel
  // with it. Without this the handler throws ReferenceError on every add.
  it('ships the tracking helper alongside the handler', () => {
    expect(handler).toContain('function trackCommerceStep')
  })

  it('is syntactically valid on its own', () => {
    expect(() => new Function(handler)).not.toThrow()
  })

  // A missing tracker (analytics disabled) must be a no-op, not a crash: this
  // code runs inside add-to-cart, where an exception costs a sale.
  it('does nothing when no tracker is published', () => {
    const trackerFn = new Function(`${handler}\nreturn trackCommerceStep;`)() as (step: {
      name: string
    }) => void
    expect(() => trackerFn({ name: 'add_to_cart' })).not.toThrow()
  })

  it('calls the tracker when one IS published', () => {
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).tpTrackCommerce = (name: string) => {
      calls.push(name)
    }
    try {
      const trackerFn = new Function(`${handler}\nreturn trackCommerceStep;`)() as (step: {
        name: string
      }) => void
      trackerFn({ name: 'add_to_cart' })
      expect(calls).toEqual(['add_to_cart'])
    } finally {
      delete (globalThis as Record<string, unknown>).tpTrackCommerce
    }
  })

  it('survives a tracker that throws', () => {
    ;(globalThis as Record<string, unknown>).tpTrackCommerce = () => {
      throw new Error('storage disabled')
    }
    try {
      const trackerFn = new Function(`${handler}\nreturn trackCommerceStep;`)() as (step: {
        name: string
      }) => void
      expect(() => trackerFn({ name: 'add_to_cart' })).not.toThrow()
    } finally {
      delete (globalThis as Record<string, unknown>).tpTrackCommerce
    }
  })
})

describe('commerce analytics — the module-reference guard', () => {
  /**
   * The failure this exists to prevent: TypeScript's CommonJS emit rewrites a
   * cross-module call into `(0, ns_1.fn)(...)`, which survives `.toString()`
   * verbatim. The generated workflow segment has no module scope, so the handler
   * throws ReferenceError the first time a shopper adds to their cart — in
   * production only, with nothing wrong-looking in the TypeScript source.
   */
  it('rejects the shape TypeScript emits for a cross-module call', () => {
    expect(() =>
      assertHandlerHasNoModuleRefs(
        "async function h() { (0, commerce_tracking_1.trackCommerceStep)('add_to_cart') }",
        'cart-add-item'
      )
    ).toThrow(/module namespace/)
  })

  it('rejects a bare namespace member access too', () => {
    expect(() => assertHandlerHasNoModuleRefs('function h() { utils_2.helper() }', 'x')).toThrow(
      /module namespace/
    )
  })

  it('passes a handler whose helpers are all local', () => {
    const source =
      "function h() { trackCommerceStep('add_to_cart') }\nfunction trackCommerceStep() {}"
    expect(assertHandlerHasNoModuleRefs(source, 'x')).toBe(source)
  })

  // A digit inside an ordinary identifier is not a namespace reference.
  it('does not flag ordinary identifiers that contain digits', () => {
    expect(() =>
      assertHandlerHasNoModuleRefs('function h() { const sha256 = x.y; return sha256 }', 'x')
    ).not.toThrow()
  })
})

describe('commerce analytics — the remove-from-cart handler', () => {
  const handler = cartRemoveItem.generateHandler()

  it('reports remove_from_cart', () => {
    expect(handler).toContain("name: 'remove_from_cart'")
  })

  it('ships the helper and references no module namespace', () => {
    expect(handler).toContain('function trackCommerceStep')
    expect(() => assertHandlerHasNoModuleRefs(handler, 'cart-remove-item')).not.toThrow()
  })

  // A remove for an id that is no longer in the cart changed nothing; counting
  // it would overstate the abandonment the merchant reads here.
  it('only reports when a line was actually removed', () => {
    expect(handler).toMatch(/if \(removed\)/)
  })

  it('is syntactically valid on its own', () => {
    expect(() => new Function(handler)).not.toThrow()
  })
})

describe('commerce analytics — the helper arity rule', () => {
  /**
   * `resolveHandlerEntryName` identifies a minified handler's entry point by
   * ARITY, preferring a 2-param declaration because every real entry is
   * `(config, context)`. A 2-param helper concatenated after a 1-param entry
   * therefore WINS, and the generated workflow calls the tracking helper where
   * it meant to call add-to-cart.
   *
   * The full-registry test in teleport-plugin-next-workflows is what catches
   * that; this pins the cause so the reason for the single object parameter is
   * visible from here too.
   */
  it('declares the helper with exactly one parameter', () => {
    const declaration = COMMERCE_TRACKING_HELPER_SOURCE.match(/function\s+\w+\s*\(([^)]*)\)/)
    expect(declaration).toBeTruthy()
    const params = declaration![1].trim()
    expect(params === '' ? 0 : params.split(',').length).toBe(1)
  })
})
