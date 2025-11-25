import { replaceSecretReference } from '../utils'

export const validateFirestoreConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.serviceAccount || typeof config.serviceAccount !== 'string') {
    return { isValid: false, error: 'Firestore service account JSON is required' }
  }

  const serviceAccount = config.serviceAccount as string

  // If serviceAccount is a secret reference, we assume the runtime env var will contain valid JSON
  // Example: "teleporthq.secrets.DATA_SOURCE_FIRESTORE_SERVICE_ACCOUNT"
  if (!serviceAccount.startsWith('teleporthq.secrets.')) {
    try {
      const parsed = JSON.parse(serviceAccount)
      if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
        return { isValid: false, error: 'Invalid Firestore service account JSON structure' }
      }
    } catch {
      return { isValid: false, error: 'Service account must be valid JSON' }
    }
  }

  return { isValid: true }
}

interface FirestoreConfig {
  serviceAccount?: string
  selectedTables?: Record<string, unknown>
}

export const generateFirestoreFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const firestoreConfig = config as FirestoreConfig

  return `import * as admin from 'firebase-admin'

let firestore = null

const getFirestore = () => {
  if (firestore) return firestore
  
  const rawServiceAccount = ${replaceSecretReference(firestoreConfig.serviceAccount)}
  let serviceAccount

  try {
    serviceAccount = JSON.parse(rawServiceAccount)
  } catch (error) {
    throw new Error('Invalid Firestore service account JSON: ' + error.message)
  }
  
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    })
  }
  
  firestore = admin.firestore()
  return firestore
}

export default async function handler(req, res) {
  try {
    const firestore = getFirestore()
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    let queryRef = firestore.collection('${tableName}')
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          queryRef = queryRef.where(key, 'in', value)
        } else {
          queryRef = queryRef.where(key, '==', value)
        }
      })
    }
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      for (const column of columns) {
        queryRef = queryRef
          .where(column, '>=', query)
          .where(column, '<=', query + '\\uf8ff')
      }
    }
    
    if (sortBy) {
      const sortOrderValue = sortOrder?.toLowerCase() === 'desc' ? 'desc' : 'asc'
      queryRef = queryRef.orderBy(sortBy, sortOrderValue)
    }
    
    const limitValue = limit || perPage
    if (limitValue) {
      queryRef = queryRef.limit(parseInt(limitValue))
    }
    
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage && parseInt(page) > 1 ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    if (offsetValue !== undefined) {
      queryRef = queryRef.offset(offsetValue)
    }
    
    const snapshot = await queryRef.get()
    const documents = []
    snapshot.forEach((doc) => {
      documents.push({
        id: doc.id,
        ...doc.data()
      })
    })
    
    const safeData = JSON.parse(JSON.stringify(documents))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Firestore fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
