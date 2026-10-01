import {
  FileType,
  InMemoryFileRecord,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLResourceItem,
} from '@teleporthq/teleport-types'
import {
  generateDataSourceFetcherWithCore,
  generateSafeFileName,
  buildProductTransformOptions,
} from '@teleporthq/teleport-plugin-next-data-source'

// Resources authored in `uidl.resources.items` that point at a local data
// source (baseUrl starts with `/api`, plus dataSourceId / dataSourceType /
// tableName in params) are rewritten by `teleport-project-generator` to
// import a utility module at `../utils/data-sources/<fileName>`. That
// utility module is only emitted as a side effect of the data-source plugin
// when a UIDL page actually renders a `data-provider` node for the same
// table. Pages that consume the resource only via `getStaticProps` /
// `getStaticPaths` (e.g. `/profile/[id]` using a `users` resource) never
// trigger that side effect, so the import target is missing at runtime and
// Next fails with "Module not found". This plugin closes that gap by
// ensuring every data-source resource has its utility module generated,
// regardless of whether any page also mounts it as a data provider.
export class NextDataSourceUtilityPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const resourceItems = structure.uidl.resources?.items
    if (!resourceItems || !structure.uidl.dataSources) {
      return structure
    }

    for (const resource of Object.values(resourceItems)) {
      if (!isDataSourceResource(resource)) {
        continue
      }

      ensureDataSourceUtilityModule(structure, {
        dataSourceId: String(resource.params.dataSourceId.content),
        dataSourceType: String(resource.params.dataSourceType.content),
        tableName: String(resource.params.tableName.content),
      })
    }

    return structure
  }
}

/**
 * The `utils/data-sources/<file>` module a server-side caller imports to read
 * a table, emitted when no page emitted it already.
 *
 * @returns the module's file name, or `null` when the data source is unknown
 *   or cannot produce a fetcher.
 */
export const ensureDataSourceUtilityModule = (
  structure: ProjectPluginStructure,
  params: { dataSourceId: string; dataSourceType: string; tableName: string }
): string | null => {
  const { uidl, files } = structure
  const { dataSourceId, dataSourceType, tableName } = params

  const dataSource = uidl.dataSources?.[dataSourceId]
  if (!dataSource) {
    return null
  }

  const fileName = generateSafeFileName(dataSourceType, tableName, dataSourceId)
  if (!fileName || fileName === 'unknown') {
    return null
  }

  if (hasUtilityFile(files, fileName)) {
    return fileName
  }

  let fetcherCode: string
  try {
    fetcherCode = generateDataSourceFetcherWithCore(
      dataSource,
      tableName,
      false,
      buildProductTransformOptions(uidl)
    )
  } catch {
    return null
  }

  const record: InMemoryFileRecord = {
    path: ['utils', 'data-sources'],
    files: [
      {
        name: fileName,
        fileType: FileType.JS,
        content: fetcherCode,
      },
    ],
  }
  files.set(`resource-utils/data-sources/${fileName}`, record)
  return fileName
}

const isDataSourceResource = (resource: UIDLResourceItem): boolean => {
  return (
    resource.path?.baseUrl?.type === 'static' &&
    typeof resource.path.baseUrl.content === 'string' &&
    resource.path.baseUrl.content.startsWith('/api') &&
    resource.params?.dataSourceId?.type === 'static' &&
    resource.params?.dataSourceType?.type === 'static' &&
    resource.params?.tableName?.type === 'static'
  )
}

// A page-emitted utility file lands under any `resource-*` key whose record
// contains a matching filename in the `utils/data-sources` folder — be
// permissive when deduping to cover all current emission sites.
const hasUtilityFile = (files: Map<string, InMemoryFileRecord>, fileName: string): boolean => {
  let found = false
  files.forEach((record) => {
    if (found) {
      return
    }
    if (!record?.path || record.path.join('/') !== 'utils/data-sources') {
      return
    }
    if (record.files?.some((file: { name: string }) => file?.name === fileName)) {
      found = true
    }
  })
  return found
}
