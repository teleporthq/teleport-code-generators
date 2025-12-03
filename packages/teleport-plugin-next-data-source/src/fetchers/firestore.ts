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
  const serviceAccount = firestoreConfig.serviceAccount

  return `import * as admin from 'firebase-admin'

let firestore = null

const getFirestore = () => {
  if (firestore) return firestore
  
  const rawServiceAccount = ${replaceSecretReference(serviceAccount)}
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
    
    let usePostFiltering = false
    
    if (query) {
      if (queryColumns) {
        const columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
        for (const column of columns) {
          queryRef = queryRef
            .where(column, '>=', query)
            .where(column, '<=', query + '\\uf8ff')
        }
      } else {
        // Firestore doesn't support full-text search without queryColumns
        // We'll fetch all data and filter in JavaScript
        usePostFiltering = true
      }
    }
    
    if (sortBy) {
      const sortOrderValue = sortOrder?.toLowerCase() === 'desc' ? 'desc' : 'asc'
      queryRef = queryRef.orderBy(sortBy, sortOrderValue)
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage && parseInt(page) > 1 ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    // Only apply pagination at query level if not post-filtering
    if (!usePostFiltering) {
      if (limitValue) {
        queryRef = queryRef.limit(parseInt(limitValue))
      }
      if (offsetValue !== undefined) {
        queryRef = queryRef.offset(offsetValue)
      }
    }
    
    const snapshot = await queryRef.get()
    let documents = []
    snapshot.forEach((doc) => {
      documents.push({
        id: doc.id,
        ...doc.data()
      })
    })
    
    // Apply post-filtering if needed
    if (usePostFiltering && query) {
      const searchQuery = query.toLowerCase()
      documents = documents.filter((item) => {
        try {
          const stringified = JSON.stringify(item).toLowerCase()
          return stringified.includes(searchQuery)
        } catch {
          return false
        }
      })
      
      // Apply pagination after filtering
      if (limitValue) {
        const start = offsetValue || 0
        documents = documents.slice(start, start + parseInt(limitValue))
      } else if (offsetValue) {
        documents = documents.slice(offsetValue)
      }
    }
    
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
