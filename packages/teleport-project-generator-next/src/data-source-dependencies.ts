import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

const DATA_SOURCE_DEPENDENCIES: Record<string, string> = {
  teleport: 'pg@^8.11.0',
  postgresql: 'pg@^8.11.0',
  mysql: 'mysql2@^3.6.0',
  mariadb: 'mariadb@^3.2.0',
  'amazon-redshift': 'pg@^8.11.0', // Redshift uses PostgreSQL client
  mongodb: 'mongodb@^6.3.0',
  cockroachdb: 'pg@^8.11.0', // CockroachDB uses PostgreSQL client
  tidb: 'mysql2@^3.6.0', // TiDB uses MySQL client
  redis: 'redis@^4.6.0',
  firestore: 'firebase-admin@^12.0.0',
  clickhouse: '@clickhouse/client@^1.13.0',
  airtable: 'node-fetch@^2.7.0',
  supabase: '@supabase/supabase-js@^2.38.0',
  turso: '@libsql/client@^0.4.0',
  'rest-api': 'node-fetch@^2.7.0',
  javascript: '', // No dependency needed
  'csv-file': '', // No dependency needed
  'google-sheets': 'node-fetch@^2.7.0',
}

export class NextDataSourceDependenciesPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl } = structure

    // Check if dataSources exist
    if (!uidl.dataSources || Object.keys(uidl.dataSources).length === 0) {
      return structure
    }

    // Collect dependencies based on data source types
    const dependencies: Record<string, string> = {}

    Object.values(uidl.dataSources).forEach((dataSource) => {
      // Supabase with connectionString (no supabaseUrl) falls back to pg driver
      const depString =
        dataSource.type === 'supabase' &&
        dataSource.config?.connectionString &&
        !dataSource.config?.supabaseUrl
          ? DATA_SOURCE_DEPENDENCIES.postgresql
          : DATA_SOURCE_DEPENDENCIES[dataSource.type]
      if (!depString) {
        return
      }

      // Parse "package@^version" format, accounting for scoped packages (e.g. @scope/package)
      const separatorIndex = depString.lastIndexOf('@')

      if (separatorIndex <= 0 || separatorIndex === depString.length - 1) {
        return
      }

      const packageName = depString.substring(0, separatorIndex)
      const version = depString.substring(separatorIndex + 1) // Includes the ^
      dependencies[packageName] = version
    })

    if (Object.keys(dependencies).length === 0) {
      return structure
    }

    // Merge dependencies into structure
    structure.dependencies = { ...structure.dependencies, ...dependencies }

    return structure
  }
}
