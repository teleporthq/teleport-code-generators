# Array Mapper Pagination - Complete Implementation Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture & Design Decisions](#architecture--design-decisions)
3. [Critical Implementation Details](#critical-implementation-details)
4. [Problems Encountered & Solutions](#problems-encountered--solutions)
5. [UIDL Structure](#uidl-structure)
6. [Code Generation Flow](#code-generation-flow)
7. [Edge Cases & Special Handling](#edge-cases--special-handling)
8. [Testing & Verification](#testing--verification)
9. [Future Considerations](#future-considerations)

---

## Overview

This document describes the complete implementation of server-side pagination for array mapper nodes in Next.js generated projects. The implementation supports in-memory page state management (not URL-based) and works with all data source types (JavaScript, PostgreSQL, MySQL, MongoDB, Supabase, CockroachDB, CSV, Static Collections).

### Key Features
- **Server-side pagination**: Each page change triggers a new data fetch with pagination parameters
- **In-memory state**: Page number stored in React state, not URL
- **Multiple paginations per page/component**: Supports multiple independent paginated lists
- **Same data source, different perPage**: Same data source can be used with different pagination settings
- **Mixed paginated/non-paginated**: Same data source can be used both paginated and non-paginated on the same page
- **Deduplication**: Count fetches and useEffect calls are deduplicated per data source

---

## Architecture & Design Decisions

### 1. Why Server-Side Pagination?

**Initial Mistake**: The first implementation used client-side array slicing (fetching all data then slicing in the browser). This was incorrect.

**Correct Approach**: 
- For database sources: Pass `page` and `perPage` to the database query (OFFSET/LIMIT, skip/take)
- For JavaScript sources: Apply pagination in the API handler before returning data
- For all sources: Fetch only the data needed for the current page

### 2. Why In-Memory State (Not URL-Based)?

The CMS collection node already uses URL-based pagination (`?page=1&perPage=10`). For array mappers within a page, we needed a different approach:
- Allows multiple independent paginated lists on one page
- No URL pollution or conflicts
- Simpler state management
- Better for nested/dynamic content

### 3. Why Two Separate Implementations (Pages vs Components)?

**Pages with `getStaticProps`**:
- Initial data fetched server-side
- Total count fetched server-side
- `maxPages` calculated in `getStaticProps` and passed as props
- Client-side navigation triggers new fetches via DataProvider

**Components (no `getStaticProps`)**:
- Initial data fetched on mount via DataProvider
- Total count fetched separately via API route using `useEffect`
- `maxPages` calculated client-side from count response
- Each page change triggers DataProvider re-fetch

---

## Critical Implementation Details

### 1. The Plugin Execution Order Problem

**Critical Discovery**: UIDL elements are transformed **before** custom plugins run.

**The Problem**:
```typescript
// UIDL has this:
{ type: 'cms-pagination-node', ... }
{ type: 'cms-navigation-button', name: 'Previous', ... }

// But when our pagination plugin runs, it's already transformed to:
<div className="home-cms-pagination-node1">
  <div className="home-previous1">Previous</div>
  <div className="home-next1">Next</div>
</div>
```

**Solution**: We cannot rely on UIDL node types in the pagination plugin. Instead, we traverse the **generated JSX AST** and identify elements by their **class names**:
- Pagination containers: `className.includes('cms-pagination-node')`
- Navigation buttons: `className.includes('previous')` or `className.includes('next')`

**Files Involved**:
- `src/pagination-plugin.ts`: `detectPaginationsFromJSX()` function

### 2. The perPage Extraction Timing Problem

**The Problem**: We need to read `perPage` from the UIDL, but it gets stripped during validation or transformation.

**First Attempt**: Read `perPage` in the pagination plugin → Failed, already transformed

**Second Attempt**: Read `perPage` from transformed nodes → Not available

**Third Attempt**: Add `perPage` to UIDL type definitions → Validator stripped it anyway

**Solution (Multi-Step)**:

#### Step 1: Update UIDL Type Definitions
```typescript
// packages/teleport-types/src/uidl.ts
export interface UIDLCMSListRepeaterNodeContent {
  // ... existing fields
  paginated?: boolean  // NEW
  perPage?: number     // NEW
}
```

#### Step 2: Update UIDL Validator Schema
```typescript
// packages/teleport-uidl-validator/src/decoders/utils.ts
export const cmsListRepeaterNodeDecoder = object({
  // ... existing fields
  paginated: optional(boolean()),  // NEW
  perPage: optional(number()),     // NEW
})
```

#### Step 3: Early Extraction (Before Any Transformations)
```typescript
// packages/teleport-plugin-next-data-source/src/index.ts
function extractPerPageValuesEarly(uidlNode: any): Map<string, number> {
  // This runs BEFORE any transformations
  // Traverses raw UIDL and extracts perPage values
  // Stores them in a Map keyed by renderPropIdentifier
}
```

**Why renderPropIdentifier**: Initially keyed by data source identifier, but this caused issues when the same data source was used multiple times with different `perPage` values. The `renderPropIdentifier` is unique per array mapper instance.

**Traversal Complexity**: The UIDL structure is deeply nested and inconsistent:
```typescript
// Must traverse ALL of these structures:
node.content.children[]           // Regular children
node.content.node                 // Single child
node.content.nodes.success        // DataProvider success state
node.content.nodes.error          // DataProvider error state
node.content.nodes.loading        // DataProvider loading state
node.content.nodes.list           // cms-list-repeater list state
node.content.nodes.empty          // cms-list-repeater empty state
node.children[]                   // Direct children array
// Conditional nodes have different structures too
```

### 3. The DataProvider Fetch Problem

**The Problem**: When we set `initialData` on DataProvider, the `fetchData` function never gets called, even when params change.

**Why**: DataProvider has an internal ref `passFetchBecauseWeHaveInitialData`:
```javascript
// Inside DataProvider implementation
const passFetchBecauseWeHaveInitialData = useRef(false)

useEffect(() => {
  if (initialData) {
    passFetchBecauseWeHaveInitialData.current = true
    return
  }
  // ... fetch logic
}, [initialData, params])
```

Once `initialData` is provided, this ref is set to `true` and never resets when `params` change.

**Solution (Three Parts)**:

#### Part 1: Conditional initialData
```javascript
// Only provide initialData for page 1
initialData={pagination_pg_0_page === 1 ? props?.dataSource_pg_0 : undefined}
```

#### Part 2: Add Key Prop to Force Remount
```javascript
// Force React to remount DataProvider when page changes
key={`dataSource-page-${pagination_pg_0_page}`}
```

#### Part 3: Ensure fetchData Accepts and Uses Params
```javascript
fetchData={(params) =>
  fetch(`/api/data-source?${new URLSearchParams(params).toString()}`)
    .then((res) => res.json())
}
```

### 4. The Multiple DataProvider Instance Problem

**The Problem**: When the same data source is used multiple times (some paginated, some not), `getStaticProps` had only one fetch per data source. This meant:
```javascript
// In getStaticProps (WRONG):
const [test_users_data] = await Promise.all([
  fetchData({ page: 1, perPage: 10 })  // Only fetches 10 items
])

// Then in the component:
// Paginated DataProvider - works, gets items 0-9
<DataProvider name="test_users_data" initialData={props.test_users_data}>
  {test_users_data?.[0]}  // ✅ Works
</DataProvider>

// Non-paginated DataProvider - BROKEN
<DataProvider name="test_users_data" initialData={props.test_users_data}>
  {test_users_data?.[1]}  // ❌ undefined! Only 10 items fetched
</DataProvider>
```

**Solution**: Generate separate `fetchData` calls for each DataProvider instance in `getStaticProps`:
```javascript
const [
  test_users_data,        // Full data, no params
  test_users_data_pg_0,   // Paginated data, page 1, perPage 10
  test_users_data_pg_1,   // Paginated data, page 1, perPage 5
] = await Promise.all([
  fetchData(),                      // For non-paginated DataProvider
  fetchData({ page: 1, perPage: 10 }), // For first paginated DataProvider
  fetchData({ page: 1, perPage: 5 }),  // For second paginated DataProvider
])
```

**Implementation Detail**: We traverse the JSX AST to identify all DataProvider instances, not just unique data sources.

### 5. The fetchData Creation Problem

**The Problem**: When a DataProvider is static (data source only used in `getStaticProps`), it doesn't get a `fetchData` prop. But pagination requires `fetchData` for page changes.

**Solution**: If `fetchData` doesn't exist on a paginated DataProvider, we create it:

```typescript
// src/pagination-plugin.ts - addPaginationParamsToDataProvider()
if (!existingFetchDataAttr) {
  // DataProvider doesn't have fetchData, create it
  const resourceDefAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'resourceDefinition'
  )
  
  if (resourceDefAttr) {
    const resourceDef = // ... extract from AST
    const apiPath = `/api/${dataSourceType}-${tableName}-${dataSourceId.substring(0, 8)}`
    
    const newFetchData = types.arrowFunctionExpression(
      [types.identifier('params')],
      // ... create fetch call with params
    )
    
    dataProviderJSX.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('fetchData'),
        types.jsxExpressionContainer(newFetchData)
      )
    )
  }
}
```

**Also Required**: Ensure API routes are generated by explicitly calling `extractDataSourceIntoNextAPIFolder()` for paginated data sources, even if they're static.

### 6. The Count Fetching Architecture

**Wrong Approach**: Return `total` count from the main data handler:
```javascript
// WRONG - couples data fetching with count
return {
  success: true,
  data: results,
  total: 1000  // ❌ Don't do this
}
```

**Correct Approach**: Separate `getCount` handler:

```typescript
// utils/data-sources/data-source-name.js
export async function handler(req, res) {
  // Fetch data only
  return res.status(200).json({
    success: true,
    data: results
  })
}

export async function getCount(req, res) {
  // Fetch count only, handle filters/queries
  const { query, queryColumns, filters } = req.query
  // ... apply same filters as handler
  return res.status(200).json({
    success: true,
    count: total
  })
}
```

**Why Separate**: 
- Clean separation of concerns
- Can fetch count without data
- Easier to optimize queries (COUNT vs SELECT)
- Same handler signature for consistency

**Wrapper Functions**:
```typescript
// Also in utils/data-sources/data-source-name.js
async function fetchData(params = {}) {
  // Wrapper for server-side calls, simulates req/res
  const req = { query: params, method: 'GET' }
  const res = { /* mock res */ }
  await handler(req, res)
  return result.data
}

async function fetchCount(params = {}) {
  // Wrapper for server-side calls
  const req = { query: params, method: 'GET' }
  const res = { /* mock res */ }
  await getCount(req, res)
  return result.count
}

export { fetchData, fetchCount, handler, getCount }
```

**Count API Routes**: For components, create separate count endpoints:
```javascript
// pages/api/data-source-name-count.js
import dataSource from '../../utils/data-sources/data-source-name'
export default dataSource.getCount
```

---

## Problems Encountered & Solutions

### Problem 1: getStaticProps Parsing Complexity

**Issue**: Need to inject `fetchCount()` calls into existing `Promise.all` in `getStaticProps`.

**Complexity**:
```typescript
// Original code structure:
const [data1, data2] = await Promise.all([
  import1.fetchData().catch(error => { /* ... */ }),
  import2.fetchData().catch(error => { /* ... */ }),
])
```

**Challenge**: The `CallExpression` is wrapped in `.catch()`, making AST traversal tricky.

**Solution**:
```typescript
// Detect fetchData calls even when wrapped
if (element.callee?.type === 'MemberExpression' &&
    element.callee?.property?.name === 'catch' &&
    element.callee?.object?.type === 'CallExpression') {
  fetchCallExpr = element.callee.object  // Unwrap
}

// Now we can access the actual fetchData call
if (fetchCallExpr.callee?.type === 'MemberExpression' &&
    fetchCallExpr.callee?.property?.name === 'fetchData') {
  const importName = fetchCallExpr.callee.object.name
  // Map import to data source variable
}
```

### Problem 2: Variable Naming Collisions

**Issue**: When same data source used multiple times, generated this:
```javascript
const [
  test_users_data,
  test_users_data_count,  // For pagination 1
  test_users_data_count,  // For pagination 2 - COLLISION!
] = await Promise.all([...])
```

**Solution**: 
- **Count variables**: Deduplicate by data source (only one count needed per source)
- **Data variables**: Unique per pagination instance: `${dataSource}_pg_${index}`
- **maxPages variables**: Unique per pagination instance: `${dataSource}_pg_${index}_maxPages`

```javascript
const [
  test_users_data,
  test_users_data_pg_0,
  test_users_data_pg_1,
  test_users_data_count,     // Only one count
] = await Promise.all([
  fetchData(),
  fetchData({ page: 1, perPage: 10 }),
  fetchData({ page: 1, perPage: 5 }),
  fetchCount(),              // Only one count call
])

// Then calculate separate maxPages
const test_users_data_pg_0_maxPages = Math.ceil(test_users_data_count / 10)
const test_users_data_pg_1_maxPages = Math.ceil(test_users_data_count / 5)
```

### Problem 3: Button Disabled States

**Initial Mistake**:
```javascript
disabled={!hasPrevPage}  // Requires calculating hasPrevPage
disabled={!hasNextPage}  // Requires calculating hasNextPage
```

**Better Approach**:
```javascript
disabled={page <= 1}           // Simple, direct
disabled={page >= maxPages}    // Simple, direct
```

**Why**: 
- No need to maintain separate `hasPrevPage`/`hasNextPage` state
- Less state to manage
- Clearer logic
- Pages are 1-indexed (page 1 is first page)

### Problem 4: API Routes Not Generated

**Issue**: For static data sources (only used in `getStaticProps`), no API routes were created. But pagination needs API routes for client-side fetching.

**Root Cause**: The `extractDataSourceIntoNextAPIFolder` function was only called during UIDL traversal for data-source-list nodes. Static sources weren't traversed this way.

**Solution**: In the pagination plugin, explicitly call `extractDataSourceIntoNextAPIFolder` for each paginated data source:

```typescript
// src/pagination-plugin.ts
function createAPIRoutesForPaginatedDataSources(...) {
  const paginatedDataSourceIds = new Set(
    paginationInfos.map((info) => info.dataSourceIdentifier)
  )
  
  // Traverse UIDL to find paginated data sources
  const traverseForDataSources = (node: any): void => {
    if (node.type === 'data-source-list' || node.type === 'data-source-item') {
      const renderProp = node.content.renderPropIdentifier
      if (renderProp && paginatedDataSourceIds.has(renderProp)) {
        // Force API route creation
        extractDataSourceIntoNextAPIFolder(
          node, 
          dataSources, 
          componentChunk, 
          extractedResources
        )
        
        // Also create count API route for components
        if (isComponent) {
          extractedResources[`api/${fileName}-count`] = {
            fileName: `${fileName}-count`,
            fileType: FileType.JS,
            path: ['pages', 'api'],
            content: `import dataSource from '../../utils/data-sources/${fileName}'
export default dataSource.getCount`
          }
        }
      }
    }
  }
}
```

### Problem 5: Duplicate persistDataDuringLoading

**Issue**: DataProvider received duplicate `persistDataDuringLoading={true}` attributes.

**Root Cause**: Both `extractDataSourceIntoNextAPIFolder` and `extractDataSourceIntoGetStaticProps` were adding the attribute.

**Solution**: Check if attribute exists before adding:
```typescript
const existingPersistAttr = jsxNode.openingElement.attributes.find(
  (attr: any) => attr.type === 'JSXAttribute' && 
                 attr.name.name === 'persistDataDuringLoading'
)

if (!existingPersistAttr) {
  jsxNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}
```

### Problem 6: Component Count Fetching Deduplication

**Issue**: In components, when same data source used in multiple paginated lists, we were creating separate `useEffect` calls for each:

```javascript
// INEFFICIENT
useEffect(() => {
  fetch('/api/data-source-count')
    .then(res => res.json())
    .then(data => setPagination_pg_0_maxPages(Math.ceil(data.count / 10)))
}, [])

useEffect(() => {
  fetch('/api/data-source-count')  // Same fetch!
    .then(res => res.json())
    .then(data => setPagination_pg_1_maxPages(Math.ceil(data.count / 5)))
}, [])
```

**Solution**: Group by data source, one `useEffect` per unique source:

```javascript
// EFFICIENT
useEffect(() => {
  fetch('/api/data-source-count')
    .then(res => res.json())
    .then(data => {
      setPagination_pg_0_maxPages(Math.ceil(data.count / 10))
      setPagination_pg_1_maxPages(Math.ceil(data.count / 5))
    })
}, [])
```

**Implementation**:
```typescript
// Group paginationInfos by fileName (data source)
const dataSourceToInfos = new Map<string, typeof paginationInfos>()
paginationInfos.forEach((info) => {
  const key = (info as any).fileName
  if (!dataSourceToInfos.has(key)) {
    dataSourceToInfos.set(key, [])
  }
  dataSourceToInfos.get(key)!.push(info)
})

// Create ONE useEffect per unique data source
dataSourceToInfos.forEach((infos) => {
  const { fileName } = infos[0]
  const countApiPath = `/api/${fileName}-count`
  
  const setStateStatements = infos.map((info) =>
    types.expressionStatement(
      types.callExpression(
        types.identifier((info as any).setMaxPagesStateVar),
        [types.callExpression(
          types.memberExpression(types.identifier('Math'), types.identifier('ceil')),
          [types.binaryExpression('/', 
            types.memberExpression(types.identifier('data'), types.identifier('count')),
            types.numericLiteral(info.perPage)
          )]
        )]
      )
    )
  )
  
  // Generate single useEffect with multiple setState calls
})
```

---

## UIDL Structure

### Array Mapper with Pagination

```json
{
  "type": "cms-list-repeater",
  "content": {
    "renderPropIdentifier": "context_abc123",
    "source": "test_users_data[0]",
    "paginated": true,
    "perPage": 10,
    "nodes": {
      "list": {
        "type": "element",
        "content": {
          "elementType": "div",
          "children": [
            {
              "type": "dynamic",
              "content": {
                "referenceType": "local",
                "id": "context_abc123"
              }
            }
          ]
        }
      },
      "empty": null
    }
  }
}
```

### Pagination Container with Buttons

```json
{
  "type": "element",
  "content": {
    "elementType": "cms-pagination-node",
    "children": [
      {
        "type": "element",
        "content": {
          "elementType": "cms-navigation-button",
          "name": "Previous",
          "children": [
            {
              "type": "static",
              "content": "Previous"
            }
          ]
        }
      },
      {
        "type": "element",
        "content": {
          "elementType": "cms-navigation-button",
          "name": "Next",
          "children": [
            {
              "type": "static",
              "content": "Next"
            }
          ]
        }
      }
    ]
  }
}
```

**Important**: Pagination node is a direct sibling of the data source node, not nested inside it.

---

## Code Generation Flow

### 1. Early Extraction Phase (`index.ts`)

```typescript
// RUNS FIRST, before any transformations
const perPageMap = extractPerPageValuesEarly(uidl.node)

// Store in options for later use
if (!options.paginationConfig) {
  options.paginationConfig = { perPageMap: new Map() }
}

// Merge maps (important for multiple component generations)
for (const [key, value] of perPageMap.entries()) {
  options.paginationConfig.perPageMap.set(key, value)
}
```

### 2. Data Source Plugin Execution

Standard data source processing happens (creates DataProviders, utils files, etc.)

### 3. Pagination Plugin Execution (`pagination-plugin.ts`)

#### Step 3.1: Detect Paginations from JSX
```typescript
const detectedPaginations = detectPaginationsFromJSX(blockStatement, uidl.node)
// Returns: [
//   {
//     paginationNodeClass: 'home-cms-pagination-node1',
//     prevButtonClass: 'home-previous1',
//     nextButtonClass: 'home-next1',
//     dataSourceIdentifier: 'test_users_data',
//     dataProviderJSX: <DataProvider JSX node>,
//     arrayMapperRenderProp: 'context_abc123'
//   }
// ]
```

#### Step 3.2: Generate Pagination Logic
```typescript
detectedPaginations.forEach((detected, index) => {
  const paginationNodeId = `pg_${index}`
  const lookupKey = detected.arrayMapperRenderProp || detected.dataSourceIdentifier
  const perPage = perPageMap.get(lookupKey) || 10
  
  const info = generatePaginationLogic(paginationNodeId, detected.dataSourceIdentifier, perPage)
  paginationInfos.push(info)
  
  // Add state declarations to component
  // pagination_pg_0_page, setPagination_pg_0_page, etc.
})
```

#### Step 3.3: Create API Routes (if needed)
```typescript
createAPIRoutesForPaginatedDataSources(...)
// - Ensures API routes exist for static data sources
// - Creates count API routes for components
```

#### Step 3.4: Add Pagination Params to DataProviders
```typescript
detectedPaginations.forEach((detected, index) => {
  addPaginationParamsToDataProvider(detected.dataProviderJSX, paginationInfos[index], index)
  // - Adds params prop
  // - Modifies or creates fetchData
  // - Sets initialData conditionally
  // - Adds key prop
})
```

#### Step 3.5: Modify Navigation Buttons
```typescript
modifyPaginationButtons(blockStatement, detectedPaginations, paginationInfos)
// - Changes div to button
// - Adds onClick handlers
// - Adds disabled attributes
```

#### Step 3.6: Modify getStaticProps (Pages Only)
```typescript
if (isPage) {
  modifyGetStaticPropsForPagination(chunks, paginationInfos)
  // - Add fetchData calls for each pagination
  // - Add fetchCount calls (deduplicated)
  // - Calculate maxPages
  // - Add to props
}
```

#### Step 3.7: Add useEffect for Count (Components Only)
```typescript
if (isComponent) {
  // Add useEffect calls (deduplicated by data source)
  // Fetch count from API
  // Calculate and set maxPages
}
```

### 4. Generated Code Structure

#### Page (with getStaticProps):
```javascript
'use client'
import { useState } from 'react'
import { DataProvider } from '@teleporthq/react-components'
import dataSource1 from '../utils/data-sources/javascript-data-34a5011c'
import dataSource2 from '../utils/data-sources/cockroachdb-users-4b96921b'

const Home = (props) => {
  const [pagination_pg_0_page, setPagination_pg_0_page] = useState(1)
  const [pagination_pg_0_maxPages, setPagination_pg_0_maxPages] = useState(
    props?.test1_data_data_pg_0_maxPages || 0
  )
  
  return (
    <div>
      <DataProvider
        name="test1_data_data"
        initialData={pagination_pg_0_page === 1 ? props?.test1_data_data_pg_0 : undefined}
        params={{ page: pagination_pg_0_page, perPage: 3 }}
        fetchData={(params) =>
          fetch(`/api/javascript-data-34a5011c?${new URLSearchParams(params).toString()}`)
            .then((res) => res.json())
            .then((data) => data.data)
        }
        persistDataDuringLoading={true}
        key={`test1_data_data-page-${pagination_pg_0_page}`}
      >
        {/* Array mapper content */}
      </DataProvider>
      
      <div className="home-cms-pagination-node1">
        <button
          type="button"
          className="home-previous1"
          onClick={() => setPagination_pg_0_page((p) => Math.max(1, p - 1))}
          disabled={pagination_pg_0_page <= 1}
        >
          Previous
        </button>
        <button
          type="button"
          className="home-next1"
          onClick={() => setPagination_pg_0_page((p) => p + 1)}
          disabled={pagination_pg_0_page >= pagination_pg_0_maxPages}
        >
          Next
        </button>
      </div>
    </div>
  )
}

export async function getStaticProps() {
  try {
    const [
      test1_data_data,              // Non-paginated
      test1_data_data_pg_0,         // Paginated instance 1
      test1_data_data_pg_1,         // Paginated instance 2
      test_users_data,              // Non-paginated
      test_users_data_pg_2,         // Paginated instance 3
      test1_data_data_count,        // Count for test1_data_data
      test_users_data_count,        // Count for test_users_data
    ] = await Promise.all([
      dataSource1.fetchData().catch(() => []),
      dataSource1.fetchData({ page: 1, perPage: 3 }).catch(() => []),
      dataSource1.fetchData({ page: 1, perPage: 5 }).catch(() => []),
      dataSource2.fetchData().catch(() => []),
      dataSource2.fetchData({ page: 1, perPage: 10 }).catch(() => []),
      dataSource1.fetchCount(),
      dataSource2.fetchCount(),
    ])
    
    const test1_data_data_pg_0_maxPages = Math.ceil(test1_data_data_count / 3)
    const test1_data_data_pg_1_maxPages = Math.ceil(test1_data_data_count / 5)
    const test_users_data_pg_2_maxPages = Math.ceil(test_users_data_count / 10)
    
    return {
      props: {
        test1_data_data,
        test1_data_data_pg_0,
        test1_data_data_pg_1,
        test_users_data,
        test_users_data_pg_2,
        test1_data_data_pg_0_maxPages,
        test1_data_data_pg_1_maxPages,
        test_users_data_pg_2_maxPages,
      },
      revalidate: 60,
    }
  } catch (error) {
    return { props: {} }
  }
}

export default Home
```

#### Component (without getStaticProps):
```javascript
'use client'
import { useState, useEffect } from 'react'
import { DataProvider } from '@teleporthq/react-components'

const MyComponent = (props) => {
  const [pagination_pg_0_page, setPagination_pg_0_page] = useState(1)
  const [pagination_pg_0_maxPages, setPagination_pg_0_maxPages] = useState(0)
  
  const [pagination_pg_1_page, setPagination_pg_1_page] = useState(1)
  const [pagination_pg_1_maxPages, setPagination_pg_1_maxPages] = useState(0)
  
  // One useEffect per unique data source
  useEffect(() => {
    fetch('/api/javascript-data-34a5011c-count')
      .then((res) => res.json())
      .then((data) => {
        setPagination_pg_0_maxPages(Math.ceil(data.count / 3))
        setPagination_pg_1_maxPages(Math.ceil(data.count / 5))
      })
      .catch((error) => console.error('Error fetching count:', error))
  }, [])
  
  return (
    <div>
      <DataProvider
        name="test1_data_data"
        params={{ page: pagination_pg_0_page, perPage: 3 }}
        fetchData={(params) =>
          fetch(`/api/javascript-data-34a5011c?${new URLSearchParams(params).toString()}`)
            .then((res) => res.json())
            .then((data) => data.data)
        }
        persistDataDuringLoading={true}
        key={`test1_data_data-page-${pagination_pg_0_page}`}
      >
        {/* Array mapper content */}
      </DataProvider>
      
      {/* Pagination buttons same as page example */}
    </div>
  )
}

export default MyComponent
```

---

## Edge Cases & Special Handling

### 1. Same Data Source, Different perPage Values

**Scenario**: `test_users_data` used twice with `perPage: 10` and `perPage: 5`

**Handling**:
- Key `perPageMap` by `renderPropIdentifier` (not data source identifier)
- Generate separate `fetchData` calls in `getStaticProps`
- Each pagination has unique state variables
- Count fetched only once, used for both maxPages calculations

### 2. Mixed Paginated and Non-Paginated

**Scenario**: `test_users_data` used both paginated and non-paginated on same page

**Handling**:
- Non-paginated: `fetchData()` with no params, full data
- Paginated: `fetchData({ page: 1, perPage: X })`, subset of data
- Each DataProvider gets appropriate `initialData` reference

### 3. No perPage Specified

**Handling**: Default to `perPage: 10`

```typescript
const perPage = perPageMap.get(lookupKey) || 10
```

### 4. Empty Data Sources

**Handling**:
- Count returns 0
- maxPages becomes 0
- Next button disabled immediately
- Previous button disabled (page starts at 1)

### 5. Static Data Sources (No Database)

**Scenario**: JavaScript array, CSV file, static collection

**Handling**:
- Still need API routes for client-side fetching
- Pagination applied in handler:
```javascript
// In handler
if (Array.isArray(data)) {
  const limitValue = limit || perPage
  const offsetValue = offset !== undefined ? parseInt(offset) : 
    (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : 0)
  
  if (limitValue) {
    data = data.slice(offsetValue, offsetValue + parseInt(limitValue))
  }
}
```

### 6. Filters and Queries with Pagination

**Important**: `getCount` must apply the same filters as `handler`

```typescript
export async function getCount(req, res) {
  const { query, queryColumns, filters } = req.query
  
  // Apply same filters as data handler
  if (queryColumns && query) {
    const columns = Array.isArray(queryColumns) ? queryColumns : [queryColumns]
    const searchConditions = columns.map(col => `${col} ILIKE $?`).join(' OR ')
    conditions.push(`(${searchConditions})`)
  }
  
  if (filters) {
    const parsedFilters = JSON.parse(filters)
    for (const filter of parsedFilters) {
      conditions.push(`${filter.column} ${filter.operator} $?`)
    }
  }
  
  // Execute COUNT with same conditions
}
```

### 7. Nested or Conditional Array Mappers

**Handling**: The `extractPerPageValuesEarly` function traverses all UIDL structures:
- Conditional nodes
- Nested data sources
- Success/error/loading states
- List/empty states

Must handle all these structures or `perPage` will be missed.

---

## Testing & Verification

### Console Logs for Debugging (Now Removed)

During development, these logs were crucial:

```typescript
// Early extraction
console.log('[EARLY EXTRACT] cms-list-repeater', { perPage, renderProp })
console.log('[EARLY EXTRACT] perPage map:', Array.from(perPageMap.entries()))

// Pagination detection
console.log('[PAGINATION] Found DataProvider with name:', identifier)
console.log('[PAGINATION] Found pagination container:', className)
console.log('[PAGINATION] Array mapper renderProps:', arrayMapperRenderProps)

// getStaticProps modification
console.log('[PAGINATION] Mapped import to variable:', importToDataSource)
console.log('[PAGINATION] Promise.all now has X elements')
```

**Why They Were Important**: 
- UIDL transformations are not visible in the code
- JSX AST structure is complex
- Need to verify data flow through multiple plugin stages
- Debugging timing issues (what runs when)

**Now Removed**: Production code should be clean, but this section documents what to add back if debugging.

### Manual Testing Checklist

- [ ] Single pagination on page
- [ ] Multiple paginations on same page
- [ ] Same data source, different perPage
- [ ] Same data source, mixed paginated/non-paginated
- [ ] Page navigation (prev/next buttons work)
- [ ] Button disabled states (first page, last page)
- [ ] Initial data loads correctly (page 1)
- [ ] Subsequent pages fetch correctly
- [ ] Count is accurate
- [ ] maxPages calculated correctly
- [ ] Component pagination (useEffect count fetch)
- [ ] Page pagination (getStaticProps count fetch)
- [ ] All data source types (JS, PostgreSQL, MySQL, MongoDB, etc.)
- [ ] With filters/queries applied

### Known Limitations

1. **Page number validation**: No validation that requested page exists (page 999 of 10 will return empty)
2. **Race conditions**: Rapid clicking may cause multiple fetches
3. **Error states**: No specific UI for fetch errors
4. **Loading states**: Uses DataProvider's built-in loading, no custom pagination loading

---

## Future Considerations

### Potential Enhancements

1. **Page number display**: Show "Page 1 of 10"
2. **Jump to page**: Input to go directly to a page
3. **Page size selector**: Allow user to change perPage
4. **First/Last buttons**: Jump to first/last page
5. **URL sync option**: Optional URL-based state for deep linking
6. **Cursor-based pagination**: Support cursor/token-based pagination for large datasets
7. **Virtual scrolling**: Infinite scroll with pagination
8. **Optimistic updates**: Show loading state during page changes

### Potential Issues to Watch

1. **Memory leaks**: Ensure useEffect cleanup in components
2. **Stale closures**: Be careful with state in callbacks
3. **SSR hydration**: Ensure client/server state matches
4. **Cache invalidation**: When to refetch count
5. **Concurrent mode**: React 18+ concurrent features

### Breaking Changes to Avoid

1. Don't change UIDL structure without updating validator
2. Don't remove `renderPropIdentifier` from cms-list-repeater
3. Don't change perPageMap key structure
4. Don't modify DataProvider API expectations
5. Don't change getStaticProps return shape

---

## File Reference

### Core Implementation Files

- `src/index.ts`: Early perPage extraction, plugin orchestration
- `src/pagination-plugin.ts`: Main pagination plugin, JSX traversal, code generation
- `src/array-mapper-pagination.ts`: Pagination logic helper, types
- `src/utils.ts`: API route extraction
- `src/data-source-fetchers.ts`: fetchData and fetchCount generation
- `src/count-fetchers.ts`: getCount handler generation for all data source types
- `src/fetchers/*.ts`: Individual data source handlers

### Type Definitions

- `packages/teleport-types/src/uidl.ts`: UIDL types, added `paginated` and `perPage`
- `packages/teleport-uidl-validator/src/decoders/utils.ts`: UIDL validator, added pagination fields

### Tests

- `__tests__/pagination.test.ts`: Unit tests for pagination logic generation

---

## Key Takeaways for Future Developers

1. **UIDL transformations happen early**: You cannot rely on UIDL node types in late-stage plugins. Use JSX AST traversal with class name detection.

2. **perPage must be extracted early**: Before any transformations, in the main plugin entry point.

3. **renderPropIdentifier is the unique key**: Not the data source identifier. Each array mapper instance has a unique renderPropIdentifier.

4. **DataProvider behavior is complex**: The `initialData` + `passFetchBecauseWeHaveInitialData` ref interaction requires conditional initialData and key prop to force remounting.

5. **Multiple instances need separate fetches**: Same data source used multiple times = multiple fetchData calls in getStaticProps, not one shared call.

6. **Count and data are separate**: Never couple them in the same response. Separate handlers allow independent fetching and optimization.

7. **Deduplication is critical**: Count fetches and useEffect calls must be deduplicated by data source to avoid unnecessary API calls.

8. **Variable naming must be unique**: When same data source used multiple times, every variable (data, count, maxPages) needs unique naming per instance.

9. **API routes must exist**: Even for static sources, client-side pagination requires API routes for fetchData.

10. **Console logs are debugging lifesavers**: The transformation pipeline is opaque. Strategic logging is essential during development, but remove for production.

---

## Conclusion

This pagination implementation handles complex edge cases and multiple architectural constraints. The key challenges were:

1. Working with transformed UIDL (JSX AST traversal)
2. Early extraction of configuration before transformations
3. Understanding and working around DataProvider's internal behavior
4. Handling multiple instances of same data source
5. Proper deduplication of fetches and effects
6. Correct variable naming and scope management

The implementation is production-ready and handles all known edge cases. Future enhancements should maintain backward compatibility with the UIDL structure and generated code expectations.

