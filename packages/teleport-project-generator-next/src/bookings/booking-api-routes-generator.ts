import {
  generateDbImport,
  isPostgresCartDataSource,
} from '../ecommerce/ecommerce-api-routes-generator'

// Read-only endpoint behind `useBookingCategories()[].itemCount`: how many
// active bookable items each category holds. `category_filter_ids` on
// `teleport_booking_items` is a TEXT column holding a JSON array of category
// ids — the assigned ones plus their ancestors — so a parent's count already
// includes its children's items. The store's `generateCategoryCountsApiRoute`
// over the products, item for item: `db` via generateDbImport, graceful inert
// answer for non-DB sources. Responds `{ counts: { "<id>": n }, total }`,
// `total` being every active item.
export const generateBookingCategoryCountsApiRoute = (
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  if (!dbImport) {
    return `export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ counts: {}, total: null })
}
`
  }

  // One aggregate over the unnested JSON arrays, Postgres only — the other
  // dialects generateDbImport knows have no jsonb, so they read the column and
  // count in JavaScript from the start.
  const aggregate = isPostgresCartDataSource(dataSourceType)
    ? `  try {
    const result = await db.query(
      "SELECT elem AS id, COUNT(*)::int AS count FROM teleport_booking_items i, jsonb_array_elements_text(COALESCE(NULLIF(i.category_filter_ids, '')::jsonb, '[]'::jsonb)) AS elem WHERE i.is_active = TRUE GROUP BY elem"
    )
    const counts = {}
    for (const row of result.rows) {
      counts[row.id] = row.count
    }
    return counts
  } catch (error) {
    // One row whose column is not valid JSON fails the cast for the whole
    // query; the JavaScript count below skips that row alone.
    console.warn('Booking category counts aggregate failed, counting in JavaScript:', error && error.message)
  }
`
    : ''

  return `${dbImport}

// Active bookable items per category id, read off every item's category_filter_ids.
async function countItemsByCategory() {
${aggregate}  const result = await db.query(
    "SELECT category_filter_ids FROM teleport_booking_items WHERE is_active = TRUE"
  )
  const counts = {}
  for (const row of result.rows) {
    let ids = []
    try {
      const raw = row.category_filter_ids
      ids = Array.isArray(raw) ? raw : JSON.parse(raw || '[]')
    } catch (_error) {
      ids = []
    }
    if (!Array.isArray(ids)) continue
    for (const id of ids) {
      counts[id] = (counts[id] || 0) + 1
    }
  }
  return counts
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const [counts, totalResult] = await Promise.all([
      countItemsByCategory(),
      // COUNT comes back as a string from node-postgres (a bigint).
      db.query("SELECT COUNT(*) AS total FROM teleport_booking_items WHERE is_active = TRUE"),
    ])
    const total = Number(totalResult.rows[0] && totalResult.rows[0].total) || 0
    return res.status(200).json({ counts, total })
  } catch (error) {
    console.error('Booking category counts error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
`
}
