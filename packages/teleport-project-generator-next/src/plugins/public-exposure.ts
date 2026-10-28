import { ProjectUIDL } from '@teleporthq/teleport-types'
import { DataExposure, PageAccess, TableAccess } from '@teleporthq/teleport-shared'

/**
 * What a plugin's PUBLIC route (the instant search, the item comparison) may
 * index and serve: only what a page every visitor may open already shows. A
 * table only signed-in, role or subscriber pages bind is never indexed — its
 * rows would answer a search no visitor could otherwise read — nor a page
 * behind a sign-in, nor a column named like a credential.
 */

/** A page every visitor may open binds the table (see `DataExposure.resolveDataExposure`). */
export const isPubliclyReadableTable = (
  uidl: ProjectUIDL,
  source: { tableName: string; dataSourceId: string; dataSourceType: string }
): boolean =>
  DataExposure.readExposureFor(DataExposure.resolveDataExposure(uidl), source).public === true

/** Every visitor may open the page at `route` (the middleware's own route table). */
export const isPublicPageRoute = (uidl: ProjectUIDL, route: string): boolean => {
  const auth = uidl.authentication
  if (!auth || auth.enabled !== true) {
    return true
  }
  return (
    PageAccess.resolveRouteAccessPolicy(PageAccess.buildProtectedRouteTable(auth), route) === null
  )
}

/** The columns without the credential-named ones (`TableAccess.isCredentialColumnName`). */
export const withoutCredentialColumns = (columns: string[]): string[] =>
  columns.filter((column) => !TableAccess.isCredentialColumnName(column))
