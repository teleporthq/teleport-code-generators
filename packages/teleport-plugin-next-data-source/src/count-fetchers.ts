import { UIDLDataSource } from '@teleporthq/teleport-types'
import { isSupabaseConnectionStringFallback } from './data-source-fetchers'
import { generatePostgreSQLCountFetcher } from './fetchers/postgresql'
import { generateMySQLCountFetcher } from './fetchers/mysql'
import { generateMariaDBCountFetcher } from './fetchers/mariadb'
import { generateMongoDBCountFetcher } from './fetchers/mongodb'
import { generateSupabaseCountFetcher } from './fetchers/supabase'
import { generateJavaScriptCountFetcher } from './fetchers/javascript'
import { generateCSVCountFetcher } from './fetchers/csv-file'
import { generateTeleportCountFetcher } from './fetchers/teleport'

export {
  generatePostgreSQLCountFetcher,
  generateMySQLCountFetcher,
  generateMariaDBCountFetcher,
  generateMongoDBCountFetcher,
  generateSupabaseCountFetcher,
  generateJavaScriptCountFetcher,
  generateCSVCountFetcher,
  generateTeleportCountFetcher,
}

export function generateCountFetcher(dataSource: UIDLDataSource, tableName: string): string {
  const { type, config } = dataSource

  switch (type) {
    case 'teleport':
      return generateTeleportCountFetcher(config, tableName)

    case 'postgresql':
    case 'cockroachdb':
      return generatePostgreSQLCountFetcher(config, tableName)

    case 'mysql':
    case 'tidb':
      return generateMySQLCountFetcher(config, tableName)

    case 'mariadb':
      return generateMariaDBCountFetcher(config, tableName)

    case 'mongodb':
      return generateMongoDBCountFetcher(config, tableName)

    case 'supabase':
      if (isSupabaseConnectionStringFallback(config)) {
        return generatePostgreSQLCountFetcher(config, tableName)
      }
      return generateSupabaseCountFetcher(config, tableName)

    case 'javascript':
      return generateJavaScriptCountFetcher(config)

    case 'csv-file':
      return generateCSVCountFetcher(config)

    default:
      return `
async function getCount(req, res) {
  try {
    // \`collectionPath\` has to travel with the rest: this counts by re-running
    // the fetch handler and measuring its result, and without the path that
    // handler gets the wrapper object rather than the records, which is not an
    // array — so the count below would report 0 for a list that clearly has rows.
    const { query, queryColumns, filters, collectionPath } = req.query
    const fakeReq = { query: { query, queryColumns, filters, collectionPath }, method: 'GET' }
    let result = null
    let statusCode = 200
    
    const fakeRes = {
      status: (code) => {
        statusCode = code
        return fakeRes
      },
      json: (data) => {
        result = data
        return fakeRes
      },
    }
    
    await handler(fakeReq, fakeRes)
    
    if (statusCode !== 200 || !result || !result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get data for counting',
        timestamp: Date.now()
      })
    }
    
    const count = Array.isArray(result.data) ? result.data.length : 0
    
    return res.status(200).json({
      success: true,
      count: count,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Error getting count:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get count',
      timestamp: Date.now()
    })
  }
}
`
  }
}
