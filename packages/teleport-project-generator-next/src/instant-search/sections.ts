import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  resolveCustomProductPageRoutes,
  resolveProductDetailsRoute,
} from '@teleporthq/teleport-plugin-next-workflows'
import { InstantSearchConfig, SEARCH_SECTION_LABELS, SearchSectionKey } from './settings'

/**
 * The sections the search route reads from the database: which table, which
 * data source, which columns to match and to show, and where a row's page is.
 * A section exists only while its feature is on, its table reachable through
 * a data source the generated fetchers know, and its rows have a page to
 * open — a result that leads nowhere is left out whole.
 */

export interface DetailsRoute {
  /** `/products` for `/products/[slug]`. */
  staticBase: string
  /** The row column the address ends with. */
  column: string
}

export interface DbSearchSection {
  key: Exclude<SearchSectionKey, 'pages'>
  label: string
  tableName: string
  dataSourceId: string
  dataSourceType: string
  route: DetailsRoute
  /** The columns the search term is matched against. */
  searchColumns: string[]
  titleColumns: string[]
  descriptionColumns: string[]
  imageColumns: string[]
  /** A column that must not read false for the row to be shown. */
  activeColumn: string | null
}

interface SectionBlueprint {
  key: DbSearchSection['key']
  tableName: string
  /** The feature's settings slot on the UIDL: present only while the feature is on. */
  present: (uidl: ProjectUIDL) => boolean
  route: (uidl: ProjectUIDL) => DetailsRoute | null
  searchColumns: string[]
  titleColumns: string[]
  descriptionColumns: string[]
  imageColumns: string[]
  activeColumn: string | null
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

const toDetailsRoute = (base: unknown, column: unknown): DetailsRoute | null => {
  const staticBase =
    typeof base === 'string' && base.startsWith('/') ? base.replace(/\/+$/, '') : ''
  return typeof column === 'string' && IDENTIFIER.test(column)
    ? { staticBase: staticBase || '', column }
    : null
}

const routeValuesOf = (uidl: ProjectUIDL): any[] => {
  const values = (uidl as any)?.root?.stateDefinitions?.route?.values
  return Array.isArray(values) ? values : []
}

const isAdminRoute = (staticBase: string): boolean =>
  staticBase === '/admin' || staticBase.startsWith('/admin/')

/**
 * The details page bound to `tableName`, from the project's routes: `<base>/[<column>]`.
 * A public page wins over an editor under `/admin` for the same table, so a compared
 * booking item opens on `/book/[slug]` rather than the admin update page.
 */
export const resolveDetailsRouteForTable = (
  uidl: ProjectUIDL,
  tableName: string
): DetailsRoute | null => {
  const matches: DetailsRoute[] = []
  for (const routeValue of routeValuesOf(uidl)) {
    const pageOptions = routeValue?.pageOptions
    const info = pageOptions?.detailsPageInfo
    if (!info || String(info.tableName || '').toLowerCase() !== tableName) {
      continue
    }
    const navLink = String(pageOptions.navLink || '')
    if (!navLink.startsWith('/')) {
      continue
    }
    const route = toDetailsRoute(
      navLink.replace(/\/\[[^\]]*\]$/, '') || '/',
      info.differentiatorColumn || pageOptions.dynamicRouteAttribute
    )
    if (route) {
      matches.push(route)
    }
  }
  return matches.find((route) => !isAdminRoute(route.staticBase)) ?? matches[0] ?? null
}

/** A content preset's post page from its site index or feed, when the project carries one. */
const contentRoute =
  (slot: 'blogSettings' | 'helpCenterSettings', tableName: string) =>
  (uidl: ProjectUIDL): DetailsRoute | null => {
    const settings = uidl[slot]
    const source = settings?.siteIndex ?? settings?.rssFeed ?? settings?.categoryPages
    return (
      resolveDetailsRouteForTable(uidl, tableName) ??
      (source ? toDetailsRoute(source.postPath, source.postUrlField) : null)
    )
  }

const BLUEPRINTS: SectionBlueprint[] = [
  {
    key: 'products',
    tableName: 'teleport_products',
    present: (uidl) => !!uidl.ecommerceSettings,
    route: (uidl) => {
      const product = resolveProductDetailsRoute(uidl)
      return product
        ? {
            staticBase: product.staticBase.replace(/\/+$/, ''),
            column: product.differentiatorColumn,
            // A product whose `product_page` names a custom page opens there, as the store links it.
            byPage: Object.fromEntries(
              Object.entries(resolveCustomProductPageRoutes(uidl)).map(([key, route]) => [
                key,
                {
                  staticBase: route.staticBase.replace(/\/+$/, ''),
                  column: route.differentiatorColumn,
                },
              ])
            ),
          }
        : null
    },
    searchColumns: ['name', 'description', 'sku', 'brand', 'tags', 'category'],
    titleColumns: ['name'],
    descriptionColumns: ['description'],
    imageColumns: ['image_url', 'imageUrl'],
    activeColumn: null,
  },
  {
    key: 'posts',
    tableName: 'teleport_blog_posts',
    present: (uidl) => !!uidl.blogSettings,
    route: contentRoute('blogSettings', 'teleport_blog_posts'),
    searchColumns: ['title', 'excerpt', 'content', 'tags', 'category'],
    titleColumns: ['title'],
    descriptionColumns: ['excerpt', 'meta_description'],
    imageColumns: ['featured_image_url', 'featuredImageUrl'],
    activeColumn: null,
  },
  {
    key: 'articles',
    tableName: 'teleport_help_articles',
    present: (uidl) => !!uidl.helpCenterSettings,
    route: contentRoute('helpCenterSettings', 'teleport_help_articles'),
    searchColumns: ['title', 'excerpt', 'content', 'tags', 'category'],
    titleColumns: ['title'],
    descriptionColumns: ['excerpt', 'meta_description'],
    imageColumns: ['featured_image_url', 'featuredImageUrl'],
    activeColumn: null,
  },
  {
    key: 'bookingItems',
    tableName: 'teleport_booking_items',
    present: (uidl) => !!uidl.bookingSettings,
    route: (uidl) => resolveDetailsRouteForTable(uidl, 'teleport_booking_items'),
    searchColumns: ['name', 'description', 'location', 'category'],
    titleColumns: ['name'],
    descriptionColumns: ['description', 'location'],
    imageColumns: ['image_url', 'imageUrl'],
    activeColumn: 'is_active',
  },
]

/** The data source a table is read through: the page resource that binds it, else the shared TeleportHQ one. */
export const resolveTableDataSource = (
  uidl: ProjectUIDL,
  tableName: string
): { dataSourceId: string; dataSourceType: string } | null => {
  for (const resource of Object.values(uidl.resources?.items ?? {})) {
    const params = resource?.params
    if (
      params?.tableName?.type === 'static' &&
      String(params.tableName.content).toLowerCase() === tableName &&
      params.dataSourceId?.type === 'static' &&
      params.dataSourceType?.type === 'static'
    ) {
      return {
        dataSourceId: String(params.dataSourceId.content),
        dataSourceType: String(params.dataSourceType.content),
      }
    }
  }
  const shared = Object.values(uidl.dataSources ?? {}).find((source) => source.type === 'teleport')
  return shared ? { dataSourceId: shared.id, dataSourceType: shared.type } : null
}

/** The database sections the configuration asks for and the project can serve, in the modal's order. */
export const resolveDbSearchSections = (
  uidl: ProjectUIDL,
  config: InstantSearchConfig
): DbSearchSection[] => {
  const sections: DbSearchSection[] = []
  for (const blueprint of BLUEPRINTS) {
    if (!config.settings.sections.includes(blueprint.key) || !blueprint.present(uidl)) {
      continue
    }
    const route = blueprint.route(uidl)
    const dataSource = resolveTableDataSource(uidl, blueprint.tableName)
    if (!route || !dataSource) {
      continue
    }
    sections.push({
      key: blueprint.key,
      label: SEARCH_SECTION_LABELS[blueprint.key],
      tableName: blueprint.tableName,
      ...dataSource,
      route,
      searchColumns: blueprint.searchColumns,
      titleColumns: blueprint.titleColumns,
      descriptionColumns: blueprint.descriptionColumns,
      imageColumns: blueprint.imageColumns,
      activeColumn: blueprint.activeColumn,
    })
  }
  return sections
}
