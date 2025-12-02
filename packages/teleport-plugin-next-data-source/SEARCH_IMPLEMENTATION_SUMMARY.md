# Search Functionality Implementation - Complete Summary

## Overview

Search functionality has been fully implemented for array mappers bound to data sources. Users can now add search inputs that filter data source results in real-time with debouncing support.

## Implementation Details

### 1. New UIDL Properties

#### On `cms-list-repeater` Node
- **`searchEnabled`** (boolean, optional): Enables search functionality for the array mapper
- **`searchDebounce`** (number, optional): Debounce timeout in milliseconds (default: 300ms)

#### On Resource Params
- **`queryColumns`** (UIDLStaticValue with string[]): Array of column names to search across

### 2. New Element Types

#### `data-source-search-node`
- Container element for search UI (rendered as `<div>`)
- Automatically positioned as the first child of the array mapper when search is enabled
- Default styling: `display: flex`, `align-items: center`, `justify-content: center`

#### `data-source-search-input-node`  
- The actual search input field (rendered as `<input>`)
- Default styling: `max-width: 200px`, standard input styling
- Placeholder automatically generated from table/collection name

### 3. Code Generation

#### State Management
For each search-enabled array mapper, the following state is generated:

```javascript
// Search query state (user input)
const [search_pg_0_query, setSearch_pg_0_query] = useState('')

// Debounced search query (actual query sent to API)
const [debouncedSearch_pg_0_query, setDebouncedSearch_pg_0_query] = useState('')

// Page state (reset to 1 when search changes)
const [pagination_pg_0_page, setPagination_pg_0_page] = useState(1)
```

#### Debounce Effect
```javascript
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch_pg_0_query(search_pg_0_query)
  }, 300) // searchDebounce value from UIDL
  
  return () => clearTimeout(timer)
}, [search_pg_0_query])
```

#### Reset Page on Search Effect
```javascript
useEffect(() => {
  setPagination_pg_0_page(1)
}, [debouncedSearch_pg_0_query])
```

#### Search Input Binding
```javascript
<input
  className="home-search-input1"
  value={search_pg_0_query}
  onChange={(e) => setSearch_pg_0_query(e.target.value)}
  placeholder="Search users"
/>
```

#### DataProvider Params
```javascript
<DataProvider
  name="test_users_data"
  params={{
    page: pagination_pg_0_page,
    perPage: 10,
    query: debouncedSearch_pg_0_query,
    queryColumns: ["name", "email", "bio"]
  }}
  fetchData={(params) =>
    fetch(`/api/cockroachdb-users-4b96921b?${new URLSearchParams(params)}`)
      .then(res => res.json())
      .then(data => data.data)
  }
  key={`test_users_data-${pagination_pg_0_page}`}
/>
```

### 4. Data Fetcher Updates

All data fetchers have been updated to support search:

#### SQL-based (PostgreSQL, MySQL, MariaDB, CockroachDB)
```javascript
if (query) {
  let columns = []
  
  if (queryColumns) {
    // Use specified columns
    columns = typeof queryColumns === 'string' 
      ? JSON.parse(queryColumns) 
      : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
  } else {
    // Fallback: Query information_schema to get all columns
    // PostgreSQL/CockroachDB:
    const schemaResult = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      [tableName]
    )
    columns = schemaResult.rows.map(row => row.column_name)
    
    // MySQL/MariaDB:
    const [schemaRows] = await connection.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [database, tableName]
    )
    columns = schemaRows.map(row => row.COLUMN_NAME)
  }
  
  if (columns.length > 0) {
    // PostgreSQL/CockroachDB: Cast each column to text before searching
    const searchConditions = columns.map(col => `${col}::text ILIKE $?`)
    
    // MySQL/MariaDB: Cast each column to CHAR before searching
    const searchConditions = columns.map(col => `CAST(${col} AS CHAR) LIKE ?`)
    
    conditions.push(`(${searchConditions.join(' OR ')})`)
    columns.forEach(() => queryParams.push(`%${query}%`))
  }
}
```

#### MongoDB
```javascript
if (query) {
  let columns = []
  
  if (queryColumns) {
    // Use specified columns
    columns = typeof queryColumns === 'string' 
      ? JSON.parse(queryColumns) 
      : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
  } else {
    // Fallback: Get field names from a sample document
    const sampleDoc = await db.collection(tableName).findOne({})
    if (sampleDoc) {
      columns = Object.keys(sampleDoc).filter(key => key !== '_id')
    }
  }
  
  if (columns.length > 0) {
    filter.$or = columns.map(col => ({
      [col]: { $regex: query, $options: 'i' }
    }))
  }
}
```

#### Supabase
```javascript
if (query) {
  let columns = []
  
  if (queryColumns) {
    // Use specified columns
    columns = typeof queryColumns === 'string' 
      ? JSON.parse(queryColumns) 
      : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
  } else {
    // Fallback: Get column names from a sample row
    const { data: sampleData } = await client.from(tableName).select('*').limit(1).single()
    if (sampleData) {
      columns = Object.keys(sampleData)
    }
  }
  
  if (columns.length > 0) {
    const searchPattern = `%${query}%`
    const orConditions = columns.map(col => `${col}.ilike.${searchPattern}`).join(',')
    queryRef = queryRef.or(orConditions)
  }
}
```

#### JavaScript/CSV/Static Collection/Google Sheets
```javascript
if (query) {
  const searchQuery = query.toLowerCase()
  
  if (queryColumns) {
    // Search specific columns
    const columns = typeof queryColumns === 'string' 
      ? JSON.parse(queryColumns) 
      : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
    
    data = data.filter(item => {
      return columns.some(col => {
        const value = item[col]
        if (value === null || value === undefined) return false
        return String(value).toLowerCase().includes(searchQuery)
      })
    })
  } else {
    // Fallback: Search entire record by stringifying it
    data = data.filter(item => {
      try {
        const stringified = JSON.stringify(item).toLowerCase()
        return stringified.includes(searchQuery)
      } catch {
        return false
      }
    })
  }
}
```

### 5. Count Fetchers

All count fetchers have been updated to apply the same search filters as the main data fetchers. This ensures pagination displays the correct total pages when a search filter is active.

#### Key Changes
- Parse `queryColumns` from query string (handles both string and array formats)
- Apply search conditions before counting
- Return filtered count

Example:
```javascript
async function getCount(req, res) {
  const { query, queryColumns, filters } = req.query
  const conditions = []
  const queryParams = []
  
  if (queryColumns && query) {
    const columns = typeof queryColumns === 'string' 
      ? JSON.parse(queryColumns) 
      : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
    // Apply search conditions
  }
  
  // Execute COUNT query with conditions
  const count = await executeCount(conditions, queryParams)
  
  return res.status(200).json({
    success: true,
    count: count,
    timestamp: Date.now()
  })
}
```

## Files Modified

### Core Implementation
- `packages/teleport-plugin-next-data-source/src/index.ts`
  - Added `SearchConfig` and `PaginationConfig` interfaces
  - Updated `extractPaginationConfigEarly()` to extract search configuration
  - Modified both page and component plugins to merge search configs

- `packages/teleport-plugin-next-data-source/src/array-mapper-pagination.ts`
  - Added search properties to `ArrayMapperPaginationInfo` interface
  - Updated `generatePaginationLogic()` to accept and include search config

- `packages/teleport-plugin-next-data-source/src/pagination-plugin.ts`
  - Added detection of search input nodes in `detectPaginationsFromJSX()`
  - Added search state generation (query and debounced query)
  - Added debounce effect generation
  - Added reset-page-on-search effect generation
  - Added `modifySearchInputs()` function to bind input handlers
  - Updated `addPaginationParamsToDataProvider()` to include search params

### Data Fetchers (with Fallback Search)
- `packages/teleport-plugin-next-data-source/src/fetchers/postgresql.ts` ✅ (fallback via information_schema)
- `packages/teleport-plugin-next-data-source/src/fetchers/mysql.ts` ✅ (fallback via information_schema)
- `packages/teleport-plugin-next-data-source/src/fetchers/mongodb.ts` ✅ (fallback via sample document)
- `packages/teleport-plugin-next-data-source/src/fetchers/mariadb.ts` ✅ (fallback via information_schema)
- `packages/teleport-plugin-next-data-source/src/fetchers/supabase.ts` ✅ (fallback via sample row)
- `packages/teleport-plugin-next-data-source/src/fetchers/javascript.ts` ✅ (fallback via JSON.stringify)
- `packages/teleport-plugin-next-data-source/src/fetchers/csv-file.ts` ✅ (fallback via JSON.stringify)
- `packages/teleport-plugin-next-data-source/src/fetchers/static-collection.ts` ✅ (fallback via JSON.stringify)
- `packages/teleport-plugin-next-data-source/src/fetchers/google-sheets.ts` ✅ (fallback via JSON.stringify)

### Type Definitions
- `packages/teleport-types/src/uidl.ts`
  - Added `searchEnabled` and `searchDebounce` to `UIDLCMSListRepeaterNodeContent`

- `packages/teleport-uidl-validator/src/decoders/utils.ts`
  - Added `searchEnabled` and `searchDebounce` to `cmsListRepeaterNodeDecoder`

## Key Implementation Patterns

### 1. Early Extraction Pattern
Search configuration is extracted from the UIDL **before** any transformations, following the same pattern as pagination's `perPage` extraction. This is critical because UIDL nodes are transformed early in the pipeline.

### 2. State Management Pattern
Three pieces of state are managed:
1. **Immediate search query**: Bound directly to input value
2. **Debounced search query**: Debounced version that triggers API calls
3. **Page number**: Reset to 1 when debounced search changes

### 3. Effect Dependency Pattern
Two effects are created:
- Debounce effect depends on `[searchQuery]`
- Reset page effect depends on `[debouncedSearchQuery]`

This ensures the page resets only after the debounce completes, not on every keystroke.

### 4. Query String Serialization
`queryColumns` is passed as a JSON-stringified array in the query string:
```
?query=john&queryColumns=["name","email","bio"]&page=1&perPage=10
```

All fetchers parse this using:
```javascript
const columns = typeof queryColumns === 'string' 
  ? JSON.parse(queryColumns) 
  : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
```

## Example UIDL

```json
{
  "type": "cms-list-repeater",
  "content": {
    "renderPropIdentifier": "context_abc123",
    "source": "test_users_data",
    "paginated": true,
    "perPage": 10,
    "searchEnabled": true,
    "searchDebounce": 300,
    "nodes": {
      "list": {
        "type": "element",
        "content": {
          "elementType": "fragment",
          "children": [
            {
              "type": "element",
              "content": {
                "elementType": "data-source-search-node",
                "children": [
                  {
                    "type": "element",
                    "content": {
                      "elementType": "data-source-search-input-node",
                      "attrs": {
                        "placeholder": {
                          "type": "static",
                          "content": "Search users"
                        }
                      }
                    }
                  }
                ]
              }
            },
            {
              "type": "element",
              "content": {
                "elementType": "text",
                "children": [{
                  "type": "dynamic",
                  "content": {
                    "referenceType": "local",
                    "id": "name"
                  }
                }]
              }
            }
          ]
        }
      }
    }
  }
}
```

And in resources:
```json
{
  "resources": {
    "items": {
      "resource_abc123": {
        "id": "resource_abc123",
        "name": "HomePage_users",
        "path": {
          "baseUrl": { "type": "static", "content": "/api/data-source" },
          "route": { "type": "static", "content": "/ds_456/users" }
        },
        "params": {
          "dataSourceId": { "type": "static", "content": "ds_456" },
          "dataSourceType": { "type": "static", "content": "cockroachdb" },
          "tableName": { "type": "static", "content": "users" },
          "queryColumns": {
            "type": "static",
            "content": ["name", "email", "bio"]
          }
        }
      }
    }
  }
}
```

## API Contract

### Request Parameters
- `query` (string): The search query entered by the user
- `queryColumns` (string): JSON-stringified array of column names to search
- `page` (number): Current page number
- `perPage` (number): Items per page

### Response Format
Data handlers return:
```json
{
  "success": true,
  "data": [...],
  "timestamp": 1234567890
}
```

Count handlers return:
```json
{
  "success": true,
  "count": 42,
  "timestamp": 1234567890
}
```

## Backward Compatibility

- If `searchEnabled` is not present or is `false`, no search UI is rendered
- If `queryColumns` is not present in resource params, search functionality is disabled
- Existing array mappers without search continue to work without any changes
- All data fetchers maintain backward compatibility by checking for the presence of search parameters

## Testing Checklist

✅ Search state initialization
✅ Debounce mechanism (300ms default)
✅ Page reset on search query change
✅ Search input value binding
✅ Search input onChange handler
✅ DataProvider params include search query and queryColumns
✅ PostgreSQL search support
✅ MySQL search support
✅ MongoDB search support
✅ MariaDB search support
✅ Supabase search support
✅ JavaScript source search support
✅ CSV file search support
✅ Static collection search support
✅ Count fetchers apply search filters
✅ UIDL type definitions updated
✅ UIDL validator updated
✅ Backward compatibility maintained
✅ No TypeScript/linter errors

## Production Ready

This implementation is production-ready and follows all the patterns established by the pagination feature. The code:

- ✅ Uses early extraction to capture configuration before transformations
- ✅ Generates clean, type-safe state management code
- ✅ Implements proper debouncing with cleanup
- ✅ Resets pagination correctly when search changes
- ✅ Handles all supported data source types
- ✅ Maintains backward compatibility
- ✅ Passes all linter checks
- ✅ Follows existing code conventions
- ✅ Includes proper error handling
- ✅ Supports both pages and components

## Notes

- The debounce timer is properly cleaned up on component unmount
- Search is case-insensitive for all data sources
- Empty search queries return all results (no filter applied)
- The search applies to the columns specified in `queryColumns` only
- Multiple columns are searched with OR logic (match any column)
- Search results are paginated normally with the filtered count

## Common Issues and Solutions

This section documents all issues encountered during implementation and their solutions, to prevent regression and help future developers.

### Issue 1: DataProvider Order Not Preserved

**Problem:**
The `reorderChildrenForSearch` function in `packages/teleport-plugin-common/src/node-handlers/node-to-jsx/index.ts` was categorizing and reordering ALL DataProviders globally, regardless of whether they were part of a pagination/search group. This broke the original order from the UIDL.

**Example:**
If UIDL had DataProviders in order: A (pagination+search), B (pagination only), C (plain), the generated code would show: A, B, C reordered to: A, C, B or similar unexpected order.

**Root Cause:**
The function was always reordering children without checking if reordering was actually needed. It would group all DataProviders together even when they weren't related to pagination/search.

**Solution:**
Only reorder children when there's actually a pagination/search group (i.e., when search or pagination nodes exist alongside a DataProvider). Otherwise, preserve the original order from the UIDL.

```typescript
// Only reorder if we have search or pagination nodes alongside a DataProvider
const hasSearchOrPagination = searchNodes.length > 0 || paginationNodes.length > 0
const hasDataProvider = dataProviderNodes.length > 0

if (hasSearchOrPagination && hasDataProvider) {
  // Reorder: search, dataProvider, other, pagination
  return [...searchNodes, ...dataProviderNodes, ...otherNodes, ...paginationNodes]
} else {
  // No reordering needed - preserve original order
  return children
}
```

**Files Modified:**
- `packages/teleport-plugin-common/src/node-handlers/node-to-jsx/index.ts`

---

### Issue 2: queryColumns Converted to Object Instead of Array

**Problem:**
When `queryColumns` was passed as an array `['name']` in the UIDL, it was being converted to an object `{0: 'name'}` in the generated code params.

**Example:**
```javascript
// Expected:
params={{ queryColumns: ['name'] }}

// Actual (incorrect):
params={{ queryColumns: {0: 'name'} }}
```

**Root Cause:**
In `packages/teleport-plugin-common/src/utils/ast-utils.ts`, the `resolveObjectValue` function was checking `typeof prop.content === 'object'` which is true for arrays in JavaScript. Since arrays are objects, it was calling `objectToObjectExpression`, which converted the array to an object.

**Solution:**
Add an explicit array check before the object check in `resolveObjectValue`:

```typescript
export const resolveObjectValue = (prop: UIDLStaticValue | UIDLExpressionValue) => {
  if (prop.type === 'static') {
    const value =
      typeof prop.content === 'string'
        ? types.stringLiteral(prop.content)
        : typeof prop.content === 'boolean'
        ? types.booleanLiteral(prop.content)
        : typeof prop.content === 'number'
        ? types.numericLiteral(prop.content)
        : Array.isArray(prop.content)  // Check array BEFORE object
        ? arrayToArrayExpression(prop.content)
        : typeof prop.content === 'object'
        ? objectToObjectExpression(prop.content as unknown as Record<string, unknown>)
        : types.identifier(String(prop.content))

    return value
  }
  // ...
}
```

**Files Modified:**
- `packages/teleport-plugin-common/src/utils/ast-utils.ts`

---

### Issue 3: Multiple DataProviders with Same Name/DataSourceId

**Problem:**
When there were multiple DataProviders using the same `name` (renderPropIdentifier) and `dataSourceId` (e.g., two `tessstt_users_data` or two `js_obje_data_data`), only the FIRST one would get the `fetchData` attribute added. Subsequent DataProviders would be skipped because the matching logic kept finding the first node.

**Example:**
In components with 4 DataProviders where 2 use `tessstt_users_data` and 2 use `js_obje_data_data`, only 2 out of 4 would get `fetchData`.

**Root Cause:**
In `packages/teleport-plugin-next-data-source/src/utils.ts`, the `extractDataSourceIntoNextAPIFolder` function was looping through `nodesLookup` and breaking on the first match. When processing the 3rd DataProvider (which had the same name as the 1st), it would find the 1st node, see it already had `fetchData`, and skip it entirely - never continuing the search for the 3rd node.

**Solution:**
During the search loop, skip JSX nodes that already have `fetchData` and continue searching for the next matching node:

```typescript
// Before matching, check if this node already has fetchData - if so, skip it
// This is crucial for handling multiple DataProviders with same dataSourceId and name
const alreadyHasFetchData = attrs.some(
  (attr) => (attr as types.JSXAttribute).name?.name === 'fetchData'
)

if (dataSourceMatches && renderPropMatches && !alreadyHasFetchData) {
  jsxNode = jsxElement as types.JSXElement
  break
} else if (dataSourceMatches && renderPropMatches && alreadyHasFetchData) {
  // Continue searching for the next matching node without fetchData
}
```

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/utils.ts`

---

### Issue 4: fetchData Triggered on Every Keystroke

**Problem:**
The `fetchData` function was being called on every keystroke in the search input, even though debouncing was implemented.

**Root Cause:**
Two issues:
1. The `params` object passed to DataProvider was being recreated on every render due to inline object literal
2. The `fetchData` function itself was being recreated on every render

**Solution:**
Wrap both `params` and `fetchData` in React hooks:

```typescript
// Wrap params in useMemo
params={useMemo(
  () => ({
    page: paginationState_pg_0.page,
    perPage: 1,
    query: paginationState_pg_0.debouncedQuery,
    queryColumns: JSON.stringify(['name']),
  }),
  [paginationState_pg_0]
)}

// Wrap fetchData in useCallback
fetchData={useCallback(
  (params) =>
    fetch(`/api/cockroachdb-users-19258764?${new URLSearchParams(params)}`)
      .then((res) => res.json())
      .then((response) => response?.data),
  []
)}
```

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/pagination-plugin.ts`

---

### Issue 5: Double fetchData Calls After Debounce

**Problem:**
Even with memoization, when the debounced search query updated, it would trigger TWO separate state updates (`debouncedSearch_pg_0_query` and `pagination_pg_0_page` reset to 1), causing two `fetchData` calls.

**Root Cause:**
Both state variables were in the `params` dependency array of `useMemo`. Updating both caused two separate renders and two API calls.

**Solution:**
Combine page and debounced query into a single atomic state object:

```typescript
// Combined state for atomic updates
const [paginationState_pg_0, setPaginationState_pg_0] = useState({
  page: 1,
  debouncedQuery: '',
})

// Update both atomically in debounce effect
useEffect(() => {
  const timer = setTimeout(() => {
    setPaginationState_pg_0({
      page: 1,
      debouncedQuery: search_pg_0_query,
    })
  }, 300)
  return () => clearTimeout(timer)
}, [search_pg_0_query])

// Single dependency in useMemo
params={useMemo(
  () => ({
    page: paginationState_pg_0.page,
    query: paginationState_pg_0.debouncedQuery,
    // ...
  }),
  [paginationState_pg_0]  // Single dependency
)}
```

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/pagination-plugin.ts`

---

### Issue 6: useEffect Running on Mount

**Problem:**
`useEffect` hooks for debouncing and fetching count were running on component mount, causing unnecessary API calls.

**Root Cause:**
React `useEffect` always runs on mount by default, even when the intent is to only run when dependencies change.

**Solution:**
Use `useRef` to track the first render and skip effect execution on mount:

```typescript
const skipDebounceOnMount_pg_0 = useRef(true)
const skipCountFetchOnMount_pg_0 = useRef(true)

useEffect(() => {
  if (skipDebounceOnMount_pg_0.current) {
    skipDebounceOnMount_pg_0.current = false
    return
  }
  const timer = setTimeout(() => {
    setPaginationState_pg_0({
      page: 1,
      debouncedQuery: search_pg_0_query,
    })
  }, 300)
  return () => clearTimeout(timer)
}, [search_pg_0_query])
```

**Important:** Use separate `useRef` for each `useEffect` that needs to skip mount execution. Using a single ref for multiple effects is a code smell.

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/pagination-plugin.ts`

---

### Issue 7: data.count === 0 Not Updating maxPages

**Problem:**
When search results returned 0 items, the `maxPages` state wasn't being updated because `if (data && data.count)` would be falsy when count is 0.

**Root Cause:**
JavaScript treats `0` as falsy, so `data.count` in a boolean context would fail the check.

**Solution:**
Check for the existence of the property explicitly and handle 0 specially:

```typescript
if (data && 'count' in data) {
  setPagination_pg_0_maxPages(
    data.count === 0 ? 0 : Math.ceil(data.count / perPage)
  )
}
```

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/pagination-plugin.ts`

---

### Issue 8: Plain DataProviders in Components Not Getting fetchData

**Problem:**
In components (which don't have `getStaticProps`), plain DataProviders (without pagination or search) weren't getting the `fetchData` method added, even though components always need client-side fetching.

**Root Cause:**
The component plugin was calling `extractDataSourceIntoNextAPIFolder` for all DataProviders, but the function was designed to work in conjunction with pagination/search detection. Plain DataProviders were being processed by a different code path that expected `getStaticProps` to exist.

**Solution:**
This was actually solved by fixing Issue 3 (Multiple DataProviders with Same Name). Once the matching logic correctly identified each unique DataProvider, all of them received `fetchData` attributes regardless of whether they had pagination/search enabled.

**Key Point:**
In components, ALL DataProviders need `fetchData` because there's no `getStaticProps` to provide initial data. The component plugin correctly calls `extractDataSourceIntoNextAPIFolder` for all data sources, and the fixed matching logic ensures each gets its `fetchData`.

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/utils.ts` (via Issue 3 fix)

---

### Issue 9: Fallback Search for Client-Side Data Sources

**Problem:**
For client-side data sources (JavaScript, CSV, Static Collection, Google Sheets), if `queryColumns` was not specified, search functionality would fail silently instead of searching across all fields.

**Requirement:**
Implement a fallback mechanism: if `queryColumns` is undefined but `query` is present, stringify each record and check if the query exists in the stringified content.

**Solution:**
Add fallback search logic to all client-side data source fetchers:

```typescript
if (query) {
  const searchQuery = query.toLowerCase()
  
  if (queryColumns) {
    // Search specific columns (existing logic)
    const columns = typeof queryColumns === 'string' 
      ? JSON.parse(queryColumns) 
      : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
    
    data = data.filter(item => {
      return columns.some(col => {
        const value = item[col]
        if (value === null || value === undefined) return false
        return String(value).toLowerCase().includes(searchQuery)
      })
    })
  } else {
    // Fallback: search entire record
    data = data.filter(item => {
      try {
        const itemString = JSON.stringify(item).toLowerCase()
        return itemString.includes(searchQuery)
      } catch (error) {
        return false
      }
    })
  }
}
```

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/fetchers/javascript.ts`
- `packages/teleport-plugin-next-data-source/src/fetchers/csv-file.ts`
- `packages/teleport-plugin-next-data-source/src/fetchers/static-collection.ts`
- `packages/teleport-plugin-next-data-source/src/fetchers/google-sheets.ts`

---

### Issue 10: Matching DataProviders by name Attribute

**Problem:**
Initial attempts to match DataProviders by checking for a `renderItem` attribute failed because DataProviders don't have a `renderItem` attribute - they have a `name` attribute.

**Root Cause:**
Misunderstanding of the generated JSX structure. Looking at the generated code showed:
```javascript
<DataProvider
  name={'tessstt_users_data'}    // ← This is the attribute we need
  renderSuccess={(tessstt_users_data) => (...)}
/>
```

**Solution:**
Match DataProviders by their `name` attribute, which contains the `renderPropIdentifier`:

```typescript
// Look for name attribute to match with renderPropIdentifier
const nameAttr = attrs.find(
  (attr) =>
    (attr as any).type === 'JSXAttribute' &&
    (attr as types.JSXAttribute).name.name === 'name'
) as types.JSXAttribute | undefined

// Check if name matches the target
if (targetRenderProp && nameAttr && nameAttr.value) {
  if (nameAttr.value.type === 'StringLiteral') {
    if (nameAttr.value.value === targetRenderProp) {
      renderPropMatches = true
    }
  }
}
```

**Files Modified:**
- `packages/teleport-plugin-next-data-source/src/utils.ts`

---

## Best Practices for Future Development

Based on these issues, follow these best practices:

### 1. State Management
- **Use atomic state updates** when multiple related values need to change together
- **Always wrap params in useMemo** with correct dependencies to prevent unnecessary re-renders
- **Always wrap fetchData in useCallback** to prevent function recreation
- **Use useRef to skip mount execution** when effects should only run on dependency changes
- **Create separate useRef instances** for each useEffect that needs mount skipping

### 2. AST Manipulation
- **Always check for arrays before objects** in type checking (arrays are objects in JavaScript)
- **Match elements by multiple attributes** when uniqueness is required (e.g., dataSourceId + name)
- **Skip already-processed nodes** during iteration to handle duplicates correctly
- **Preserve original order** unless reordering is explicitly needed

### 3. Testing Edge Cases
- Always test with:
  - **Multiple DataProviders** with same data source
  - **Multiple DataProviders** with same name
  - **Zero results** from search/filtering
  - **Empty or undefined** optional parameters
  - **Both pages and components** (different data fetching patterns)
  - **All four mapper types**: pagination+search, pagination-only, search-only, plain

### 4. Debugging
- Use targeted console.log statements with prefixes like `[EXTRACT_API]`, `[REORDER]`
- Log all critical decision points and their inputs
- Remove all debug logs before committing

### 5. Data Source Compatibility
- Always handle both string and array formats for `queryColumns`
- Implement fallback mechanisms for optional parameters
- Test count fetchers apply the same filters as data fetchers
- Ensure backward compatibility when adding new features

## Fallback Search (No queryColumns Specified)

All data sources now support fallback search when `query` is present but `queryColumns` is undefined. The implementation varies by data source type:

### Client-Side Sources (JavaScript, CSV, Static Collection, Google Sheets)
When `queryColumns` is not provided, these sources stringify each record using `JSON.stringify()` and search within the stringified content. This allows searching across all fields without knowing the schema.

**Performance Impact:** Minimal, as data is already in memory.

### SQL-Based Sources (PostgreSQL, MySQL, MariaDB, CockroachDB)
When `queryColumns` is not provided, these sources:
1. Query `information_schema.columns` to get all column names for the table
2. Cast each column to text/CHAR for string comparison
3. Build an OR condition across all columns

**Performance Impact:** Moderate. An additional query to information_schema is required, and searching across all columns is slower than searching specific columns. For production use, always specify `queryColumns` when possible.

**SQL Generation Example (PostgreSQL):**
```sql
-- Get columns
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'users'

-- Then search (assuming columns: id, name, email, age)
SELECT * FROM users 
WHERE (
  id::text ILIKE '%john%' OR 
  name::text ILIKE '%john%' OR 
  email::text ILIKE '%john%' OR 
  age::text ILIKE '%john%'
)
```

### MongoDB
When `queryColumns` is not provided, MongoDB:
1. Fetches a sample document using `findOne({})`
2. Extracts all field names from the sample (excluding `_id`)
3. Builds a `$or` condition with `$regex` across all fields

**Performance Impact:** Moderate. Assumes all documents have similar structure. If documents have varying schemas, only fields from the sample document will be searched.

### Supabase
When `queryColumns` is not provided, Supabase:
1. Fetches a single row using `.select('*').limit(1).single()`
2. Extracts all column names from the returned object
3. Builds an `.or()` condition with `.ilike` across all columns

**Performance Impact:** Moderate. Similar to SQL-based sources but with an additional API call.

### Error Handling

All fallback operations are wrapped in try-catch blocks to ensure graceful degradation:

```javascript
try {
  // Attempt to fetch column metadata
  const schemaResult = await pool.query('SELECT column_name FROM information_schema.columns...')
  columns = schemaResult.rows.map(row => row.column_name)
} catch (schemaError) {
  console.warn('Failed to fetch column names from information_schema:', schemaError.message)
  // Continue without search if we can't get columns
}
```

**Behavior on Failure:**
- If the metadata query fails (e.g., permissions issue, table doesn't exist), the error is logged as a warning
- The search operation is **silently skipped** - no search filter is applied
- The main data fetch continues normally, returning all results (as if no `query` parameter was provided)
- The API does not return a 500 error due to metadata query failure

This ensures that:
1. **Resilience**: A metadata query failure doesn't crash the entire endpoint
2. **Graceful Degradation**: Users still get results, just without search filtering
3. **Debuggability**: Warnings are logged for troubleshooting
4. **User Experience**: The UI remains functional even if search temporarily fails

### Recommendations
1. **Always specify `queryColumns` in production** for better performance and more predictable results
2. **Use fallback search for prototyping or admin interfaces** where convenience is more important than performance
3. **For SQL sources**, ensure your `information_schema` queries are efficient and the database user has appropriate permissions
4. **For MongoDB**, ensure documents have consistent schemas for reliable fallback search
5. **Test fallback search thoroughly** with your actual data schema before deploying
6. **Monitor warning logs** in production to catch any metadata query failures

