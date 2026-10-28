import { FileType, ProjectPluginStructure, UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { NextEcommerceProjectPlugin } from '../src/ecommerce/project-plugin'
import { generateCategoryCountsApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'

// The live product count per category: a GET route counting the active
// products over every product's `category_filter_ids` JSON array, and the
// ecommerce context stamping its answer on every node of `ecommerceCategories`
// as `productCount` — `undefined` until it answers, so a bound text keeps its
// drawn number.

const APP_CONTENT = [
  "import React from 'react'",
  'function MyApp({ Component, pageProps }) {',
  '  return (',
  '    <Component {...pageProps} />',
  '  )',
  '}',
  'export default MyApp',
].join('\n')

const SETTINGS: UIDLEcommerceSettings = {
  cashOnDelivery: true,
  deliveryEnabled: false,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: false,
  orderNotifications: false,
  deliveryConfig: null,
  stockManagementConfig: null,
  orderNotificationConfig: null,
  paymentProviders: [],
} as unknown as UIDLEcommerceSettings

const buildStructure = (): ProjectPluginStructure => {
  const files = new Map<string, { path: string[]; files: Array<Record<string, unknown>> }>()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  return {
    uidl: { globals: { env: {} }, ecommerceSettings: SETTINGS },
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

describe('ecommerce category product counts', () => {
  it('registers the counts route beside the variants route, even without a database', async () => {
    const plugin = new NextEcommerceProjectPlugin()
    const structure = buildStructure()

    await plugin.runAfter(structure)

    const entry = structure.files.get('ecommerce-api-category-counts')
    expect(entry?.path).toEqual(['pages', 'api', 'ecommerce'])
    expect(entry?.files[0].name).toBe('category-counts')
    // Inert without a database: nothing to count, no total.
    expect(String(entry?.files[0].content)).toContain(
      'res.status(200).json({ counts: {}, total: null })'
    )
  })

  it('counts over the unnested JSON array on Postgres, in JavaScript when the cast fails', () => {
    const route = generateCategoryCountsApiRoute('teleport', {})

    expect(route).toContain("if (req.method !== 'GET')")
    expect(route).toContain(
      "SELECT elem AS id, COUNT(*)::int AS count FROM teleport_products p, jsonb_array_elements_text(COALESCE(NULLIF(p.category_filter_ids, '')::jsonb, '[]'::jsonb)) AS elem WHERE p.status = 'active' GROUP BY elem"
    )
    expect(route).toContain(
      "SELECT category_filter_ids FROM teleport_products WHERE status = 'active'"
    )
    expect(route).toContain(
      "SELECT COUNT(*) AS total FROM teleport_products WHERE status = 'active'"
    )
    // No jsonb on MySQL: straight to the JavaScript count.
    expect(generateCategoryCountsApiRoute('mysql', {})).not.toContain('jsonb_array_elements_text')
  })

  it('stamps productCount on every category node once the route has answered', () => {
    const source = generateEcommerceContextFileContent(SETTINGS, undefined, 'ds-1')

    expect(source).toContain("fetch('/api/ecommerce/category-counts')")
    expect(source).toContain('productCount: counts ? counts[category.id] || 0 : undefined')
    expect(source).toContain('children: withProductCounts(category.children, counts)')
    expect(source).toContain('[ecommerceCategoriesRaw, router.locale, categoryCounts]')
    // The total rides on the provider value, and both are in the memo's deps.
    expect(source).toContain('    productsTotal,\n')
    expect(source).toContain('ecommerceCategories, productsTotal])')
  })
})
