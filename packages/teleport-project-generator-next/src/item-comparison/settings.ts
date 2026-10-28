import { ProjectUIDL, UIDLPluginSettingValue } from '@teleporthq/teleport-types'

/**
 * The Item comparison plugin's settings as the editor stores them
 * (`features/plugins/registry/definitions/item-comparison.ts` there), and the
 * route of its comparison page. Every value is checked: the published site
 * bakes them into its comparison runtime and its compare route.
 */

const ITEM_COMPARISON_PLUGIN_KEY = 'itemComparison'

export const COMPARE_KINDS = ['products', 'bookingItems'] as const
export type CompareKind = (typeof COMPARE_KINDS)[number]

export const PRODUCT_ATTRIBUTE_KEYS = [
  'price',
  'rating',
  'brand',
  'condition',
  'category',
  'tags',
  'weight',
  'dimensions',
  'stock',
  'sku',
] as const
export const BOOKING_ATTRIBUTE_KEYS = ['price', 'unit', 'capacity', 'duration', 'category'] as const

/** Which of the compared items' custom properties make rows: every one, the ones picked, none. */
export const CUSTOM_PROPERTY_ROWS = ['all', 'chosen', 'none'] as const
export type CustomPropertyRows = (typeof CUSTOM_PROPERTY_ROWS)[number]

const MAX_PROPERTY_NAMES = 50
const MAX_PROPERTY_NAME_LENGTH = 100

export interface ItemComparisonConfig {
  kinds: CompareKind[]
  maxItems: number
  productAttributes: string[]
  bookingAttributes: string[]
  productPropertyRows: CustomPropertyRows
  /** The products' custom properties picked as rows, when `productPropertyRows` is `chosen`. */
  productProperties: string[]
  bookingPropertyRows: CustomPropertyRows
  bookingProperties: string[]
  highlightBest: boolean
  onlyDifferences: boolean
  /** The comparison page, when the plugin has one. */
  compareRoute: string | null
}

type Stored = Record<string, UIDLPluginSettingValue | undefined>

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const integer = (value: unknown, fallback: number, min: number, max: number): number => {
  const rounded = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, rounded))
}

const chosen = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[]
): T[] =>
  Array.isArray(value) ? allowed.filter((key) => (value as unknown[]).includes(key)) : [...fallback]

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback

/** Property names as the owner picked them: text, trimmed, each once. */
const propertyNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const names: string[] = []
  for (const entry of value) {
    const name = typeof entry === 'string' ? entry.trim() : ''
    if (
      name &&
      name.length <= MAX_PROPERTY_NAME_LENGTH &&
      !names.some((known) => known.toLowerCase() === name.toLowerCase())
    ) {
      names.push(name)
    }
  }
  return names.slice(0, MAX_PROPERTY_NAMES)
}

/** The plugin's configuration when the project has it on; null otherwise. */
export const resolveItemComparisonConfig = (uidl: ProjectUIDL): ItemComparisonConfig | null => {
  const record = uidl.plugins?.[ITEM_COMPARISON_PLUGIN_KEY]
  if (
    !record ||
    typeof record !== 'object' ||
    !record.settings ||
    typeof record.settings !== 'object'
  ) {
    return null
  }
  const stored = record.settings as Stored
  const compareRoute = record.pages?.compare
  return {
    kinds: chosen(stored.kinds, COMPARE_KINDS, COMPARE_KINDS),
    maxItems: integer(stored.maxItems, 4, 2, 6),
    productAttributes: chosen(stored.productAttributes, PRODUCT_ATTRIBUTE_KEYS, [
      'price',
      'rating',
      'brand',
      'category',
      'stock',
    ]),
    bookingAttributes: chosen(
      stored.bookingAttributes,
      BOOKING_ATTRIBUTE_KEYS,
      BOOKING_ATTRIBUTE_KEYS
    ),
    productPropertyRows: oneOf(stored.productPropertyRows, CUSTOM_PROPERTY_ROWS, 'all'),
    productProperties: propertyNames(stored.productProperties),
    bookingPropertyRows: oneOf(stored.bookingPropertyRows, CUSTOM_PROPERTY_ROWS, 'all'),
    bookingProperties: propertyNames(stored.bookingProperties),
    highlightBest: bool(stored.highlightBest, true),
    onlyDifferences: bool(stored.onlyDifferences, false),
    compareRoute:
      typeof compareRoute === 'string' && compareRoute.startsWith('/') ? compareRoute : null,
  }
}
