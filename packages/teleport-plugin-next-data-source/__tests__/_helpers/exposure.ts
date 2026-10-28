import type { DataReadExposure, ProjectDataExposure } from '@teleporthq/teleport-types'
import { DataExposure } from '@teleporthq/teleport-shared'

/**
 * The exposure a project gives tables a page every visitor may open binds —
 * what `DataExposure.resolveDataExposure` decides for a public list. A read
 * route generated without one serves the app's own server code only.
 */
export const publicRead = (overrides: Partial<DataReadExposure> = {}): DataReadExposure => ({
  public: true,
  anySession: false,
  roles: [],
  defaultLimit: DataExposure.BROWSER_READ_DEFAULT_LIMIT,
  maxLimit: DataExposure.BROWSER_READ_MAX_LIMIT,
  ...overrides,
})

/** `tables` all bound by a public page (and `dataSources`, by id, for the sources without tables). */
export const publicExposure = (
  tables: string[],
  dataSources: string[] = []
): { dataExposure: ProjectDataExposure } => ({
  dataExposure: {
    tables: Object.fromEntries(
      tables.map((table) => [DataExposure.tableExposureKey(null, table), publicRead()])
    ),
    dataSources: Object.fromEntries(dataSources.map((id) => [id, publicRead()])),
  },
})
