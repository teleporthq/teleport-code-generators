import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { getDatabaseDriverDependencies } from '@teleporthq/teleport-plugin-next-workflows'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { ensureDataSourceUtilityModule } from '../data-source-utility-plugin'
import { resolveInstantSearchConfig, SearchSectionKey } from './settings'
import {
  isPublicPageRoute,
  isPubliclyReadableTable,
  withoutCredentialColumns,
} from '../plugins/public-exposure'
import { resolveDbSearchSections } from './sections'
import {
  buildSearchRouteSource,
  PAGES_INDEX_FILE,
  SEARCH_ROUTE,
  SearchRouteSection,
} from './search-route'
import {
  buildInstantSearchComponentSource,
  INSTANT_SEARCH_COMPONENT_FILE,
  INSTANT_SEARCH_COMPONENT_NAME,
} from './component-source'

const INSTANT_SEARCH_COMPONENT_FILE_KEY = 'instant-search-component'
const INSTANT_SEARCH_ROUTE_FILE_KEY = 'instant-search-route'
const INSTANT_SEARCH_INDEX_FILE_KEY = 'instant-search-index'

/** `/api/plugins/search` → `pages/api/plugins` + `search`. */
const routeFile = (route: string): { path: string[]; name: string } => {
  const segments = route.split('/').filter(Boolean)
  return { path: ['pages', ...segments.slice(0, -1)], name: segments[segments.length - 1] }
}

/**
 * The Instant search plugin on the published site: the runtime that answers
 * the project's own Search component through events, rendered once from
 * `_app`; the pages' words as a JSON module the search route imports; and the
 * route, which scans that index and reads each section's table through its
 * generated fetcher. A project without the plugin comes out exactly as before.
 */
export class NextInstantSearchProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure
    const config = resolveInstantSearchConfig(uidl)
    if (!config) {
      return structure
    }

    const route = routeFile(SEARCH_ROUTE)
    const toRoot = route.path.map(() => '..').join('/')
    const sections: SearchRouteSection[] = []
    for (const section of resolveDbSearchSections(uidl, config)) {
      // Only a table a public page shows is searched; never a column named like a credential.
      if (!isPubliclyReadableTable(uidl, section)) {
        continue
      }
      section.searchColumns = withoutCredentialColumns(section.searchColumns)
      section.titleColumns = withoutCredentialColumns(section.titleColumns)
      section.descriptionColumns = withoutCredentialColumns(section.descriptionColumns)
      section.imageColumns = withoutCredentialColumns(section.imageColumns)
      const fetcher = ensureDataSourceUtilityModule(structure, {
        dataSourceId: section.dataSourceId,
        dataSourceType: section.dataSourceType,
        tableName: section.tableName,
      })
      if (!fetcher) {
        continue
      }
      sections.push({ ...section, fetcherImport: `${toRoot}/utils/data-sources/${fetcher}` })
      for (const [name, version] of Object.entries(
        getDatabaseDriverDependencies(section.dataSourceType as never)
      )) {
        if (!dependencies[name]) {
          dependencies[name] = version
        }
      }
    }

    // A page behind a sign-in is not searched: its words would answer anyone.
    config.pages = config.pages.filter((page) => isPublicPageRoute(uidl, page.route))
    const pagesSearched = config.settings.sections.includes('pages') && config.pages.length > 0
    if (pagesSearched) {
      files.set(INSTANT_SEARCH_INDEX_FILE_KEY, {
        path: PAGES_INDEX_FILE.path,
        files: [
          {
            name: PAGES_INDEX_FILE.name,
            fileType: FileType.JSON,
            content: JSON.stringify({ pages: config.pages }),
          },
        ],
      })
    }
    files.set(INSTANT_SEARCH_ROUTE_FILE_KEY, {
      path: route.path,
      files: [
        {
          name: route.name,
          fileType: FileType.JS,
          content: buildSearchRouteSource(
            config,
            sections,
            pagesSearched
              ? `${toRoot}/${[...PAGES_INDEX_FILE.path, PAGES_INDEX_FILE.name].join('/')}.json`
              : null
          ),
        },
      ],
    })
    files.set(INSTANT_SEARCH_COMPONENT_FILE_KEY, {
      path: ['components'],
      files: [
        {
          name: INSTANT_SEARCH_COMPONENT_FILE,
          fileType: FileType.JS,
          content: buildInstantSearchComponentSource(config, [
            ...(pagesSearched ? (['pages'] as SearchSectionKey[]) : []),
            ...sections.map((section) => section.key),
          ]),
        },
      ],
    })
    injectSiblingIntoApp(structure, {
      componentName: INSTANT_SEARCH_COMPONENT_NAME,
      importStatement: `import ${INSTANT_SEARCH_COMPONENT_NAME} from '../components/${INSTANT_SEARCH_COMPONENT_FILE}';\n`,
    })
    return structure
  }
}
