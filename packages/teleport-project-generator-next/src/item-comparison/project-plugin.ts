import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import {
  getDatabaseDriverDependencies,
  resolveProductDetailsRoute,
} from '@teleporthq/teleport-plugin-next-workflows'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { ensureDataSourceUtilityModule } from '../data-source-utility-plugin'
import {
  DetailsRoute,
  resolveDetailsRouteForTable,
  resolveTableDataSource,
} from '../instant-search/sections'
import { CompareKind, resolveItemComparisonConfig } from './settings'
import { isPubliclyReadableTable, withoutCredentialColumns } from '../plugins/public-exposure'
import { buildCompareRouteSource, COMPARE_ROUTE, CompareRouteKind } from './compare-route'
import {
  buildItemComparisonComponentSource,
  ITEM_COMPARISON_COMPONENT_FILE,
  ITEM_COMPARISON_COMPONENT_NAME,
} from './component-source'

const ITEM_COMPARISON_COMPONENT_FILE_KEY = 'item-comparison-component'
const ITEM_COMPARISON_ROUTE_FILE_KEY = 'item-comparison-route'

/** `/api/plugins/compare` → `pages/api/plugins` + `compare`. */
const routeFile = (route: string): { path: string[]; name: string } => {
  const segments = route.split('/').filter(Boolean)
  return { path: ['pages', ...segments.slice(0, -1)], name: segments[segments.length - 1] }
}

interface KindBlueprint {
  kind: CompareKind
  label: string
  tableName: string
  present: (structure: ProjectPluginStructure) => boolean
  route: (structure: ProjectPluginStructure) => DetailsRoute | null
  activeColumn: string | null
  attributes: (settings: { productAttributes: string[]; bookingAttributes: string[] }) => string[]
}

const BLUEPRINTS: KindBlueprint[] = [
  {
    kind: 'products',
    label: 'Products',
    tableName: 'teleport_products',
    present: ({ uidl }) => !!uidl.ecommerceSettings,
    route: ({ uidl }) => {
      const product = resolveProductDetailsRoute(uidl)
      return product
        ? {
            staticBase: product.staticBase.replace(/\/+$/, ''),
            column: product.differentiatorColumn,
          }
        : null
    },
    activeColumn: null,
    attributes: (settings) => settings.productAttributes,
  },
  {
    kind: 'bookingItems',
    label: 'Bookable items',
    tableName: 'teleport_booking_items',
    present: ({ uidl }) => !!uidl.bookingSettings,
    route: ({ uidl }) => resolveDetailsRouteForTable(uidl, 'teleport_booking_items'),
    activeColumn: 'is_active',
    attributes: (settings) => settings.bookingAttributes,
  },
]

/**
 * The Item comparison plugin on the published site: the keeper of the
 * visitor's picks rendered once from `_app` (the Compare controls, the tray
 * and the comparison page are the project's own elements and workflows; it
 * answers them), and the compare route that reads the picked items through
 * their tables' generated fetchers. A project without the plugin comes out
 * exactly as before.
 */
export class NextItemComparisonProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure
    const config = resolveItemComparisonConfig(uidl)
    if (!config) {
      return structure
    }

    const route = routeFile(COMPARE_ROUTE)
    const toRoot = route.path.map(() => '..').join('/')
    const kinds: CompareRouteKind[] = []
    for (const blueprint of BLUEPRINTS) {
      if (!config.kinds.includes(blueprint.kind) || !blueprint.present(structure)) {
        continue
      }
      const itemRoute = blueprint.route(structure)
      const dataSource = resolveTableDataSource(uidl, blueprint.tableName)
      if (!itemRoute || !dataSource) {
        continue
      }
      // Only a table a public page shows is compared.
      if (!isPubliclyReadableTable(uidl, { ...dataSource, tableName: blueprint.tableName })) {
        continue
      }
      const fetcher = ensureDataSourceUtilityModule(structure, {
        ...dataSource,
        tableName: blueprint.tableName,
      })
      if (!fetcher) {
        continue
      }
      kinds.push({
        kind: blueprint.kind,
        label: blueprint.label,
        fetcherImport: `${toRoot}/utils/data-sources/${fetcher}`,
        route: itemRoute,
        attributes: withoutCredentialColumns(blueprint.attributes(config)),
        activeColumn: blueprint.activeColumn,
      })
      for (const [name, version] of Object.entries(
        getDatabaseDriverDependencies(dataSource.dataSourceType as never)
      )) {
        if (!dependencies[name]) {
          dependencies[name] = version
        }
      }
    }

    files.set(ITEM_COMPARISON_ROUTE_FILE_KEY, {
      path: route.path,
      files: [
        {
          name: route.name,
          fileType: FileType.JS,
          content: buildCompareRouteSource(config, kinds),
        },
      ],
    })
    files.set(ITEM_COMPARISON_COMPONENT_FILE_KEY, {
      path: ['components'],
      files: [
        {
          name: ITEM_COMPARISON_COMPONENT_FILE,
          fileType: FileType.JS,
          content: buildItemComparisonComponentSource(config),
        },
      ],
    })
    injectSiblingIntoApp(structure, {
      componentName: ITEM_COMPARISON_COMPONENT_NAME,
      importStatement: `import ${ITEM_COMPARISON_COMPONENT_NAME} from '../components/${ITEM_COMPARISON_COMPONENT_FILE}';\n`,
    })
    return structure
  }
}
