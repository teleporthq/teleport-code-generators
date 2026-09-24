import { DataSourceType, ProjectPluginStructure } from '@teleporthq/teleport-types'

export const resolveInvoiceDataSource = (
  structure: ProjectPluginStructure
): { dataSourceType: DataSourceType | null; dataSourceConfig: Record<string, unknown> | null } => {
  const { uidl } = structure

  if (!uidl.dataSources) {
    return { dataSourceType: null, dataSourceConfig: null }
  }

  if (uidl.authentication?.dataSourceId) {
    const ds = uidl.dataSources[uidl.authentication.dataSourceId]
    if (ds) {
      return { dataSourceType: ds.type, dataSourceConfig: ds.config }
    }
  }

  const dsEntries = Object.values(uidl.dataSources)
  if (dsEntries.length > 0) {
    return { dataSourceType: dsEntries[0].type, dataSourceConfig: dsEntries[0].config }
  }

  return { dataSourceType: null, dataSourceConfig: null }
}
