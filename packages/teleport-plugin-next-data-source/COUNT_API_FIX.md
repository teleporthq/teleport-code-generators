# Count API Route Fix

## Problem

When pages with pagination + search functionality were generated, the code included `useEffect` hooks that fetched from count API endpoints (e.g., `/api/cockroachdb-users-eab38133-count`), but these count API route files were not being created. This resulted in 404 errors when users searched.

### Affected Code

In the generated page `index.js`:
```javascript
useEffect(() => {
  if (skipCountFetchOnMount_pg_1.current) {
    skipCountFetchOnMount_pg_1.current = false
    return
  }
  fetch(
    `/api/cockroachdb-users-eab38133-count?${new URLSearchParams({
      query: paginationState_pg_1.debouncedQuery,
      queryColumns: JSON.stringify(['name']),
    })}`
  )
    .then((res) => res.json())
    .then((data) => {
      if (data && 'count' in data) {
        setPagination_pg_1_maxPages(
          data.count === 0 ? 0 : Math.ceil(data.count / 3)
        )
      }
    })
}, [paginationState_pg_1.debouncedQuery])
```

But `/api/cockroachdb-users-eab38133-count.js` did **not exist**.

## Root Cause

In `pagination-plugin.ts`, the `createAPIRoutesForPaginatedDataSources()` function:
```typescript
// OLD CODE (line 2354)
if (isComponent) {  // ❌ Only created for components!
  // Create count API route
  extractedResources[`api/${countFileName}`] = { ... }
}
```

The count API route was only being created for **components**, but pages with search functionality also need it to refetch count when the search query changes.

## Why Pages with Search Need Count Routes

### Different Scenarios:

1. **Pages with pagination ONLY (no search)**:
   - Initial count fetched in `getStaticProps`
   - Count is static - doesn't change during user interaction
   - ✅ No count API route needed

2. **Pages with pagination + SEARCH**:
   - Initial count fetched in `getStaticProps` (for page 1, no search)
   - Count changes when user searches
   - Need to refetch count with search parameters
   - ❌ **NEEDS count API route** (was missing!)

3. **Components with pagination (with or without search)**:
   - No `getStaticProps`
   - Always fetch count client-side
   - ✅ **NEEDS count API route** (was already working)

4. **Search-only (no pagination)**:
   - No pagination, no maxPages calculation needed
   - ✅ No count route needed

## Solution

Changed the condition from "only components" to "components OR pages with search":

```typescript
// NEW CODE (lines 2344-2364)
const searchEnabledDataSources = new Set(
  paginationInfos
    .filter((info) => info.searchEnabled)
    .map((info) => info.dataSourceIdentifier)
)

const createdCountRoutes = new Set<string>()

// ... in traverseForDataSources:
const hasSearch = searchEnabledDataSources.has(renderProp)
const needsCountRoute = isComponent || hasSearch  // ✅ Now checks both!

if (needsCountRoute) {
  const resourceDef = node.content.resourceDefinition
  if (resourceDef) {
    // ... create count route
    if (!createdCountRoutes.has(countFileName)) {
      extractedResources[`api/${countFileName}`] = {
        fileName: countFileName,
        fileType: FileType.JS,
        path: ['pages', 'api'],
        content: `import dataSource from '../../utils/data-sources/${fileName}'

export default dataSource.getCount
`,
      }
      createdCountRoutes.add(countFileName)
    }
  }
}
```

## Additional Improvements

1. **Deduplication**: Added `createdCountRoutes` Set to prevent creating the same count route multiple times when the same data source is used with different perPage settings

2. **Clear Logic**: The condition `needsCountRoute = isComponent || hasSearch` makes it explicit when count routes are needed

## Generated Files

After the fix, for a page with search, the following files are generated:

```
pages/
  api/
    cockroachdb-users-eab38133.js      ✅ Main data API route
    cockroachdb-users-eab38133-count.js ✅ Count API route (NOW CREATED!)
  
utils/
  data-sources/
    cockroachdb-users-eab38133.js       ✅ Data source module with fetchData, fetchCount, handler, getCount
```

## Testing

Verified with the provided UIDL containing:
- Table with pagination + search
- Array mapper with pagination + search
- Both bound to the same CockroachDB data source

Results:
- ✅ Count API route created: `/api/cockroachdb-users-eab38133-count.js`
- ✅ File exports `dataSource.getCount` handler
- ✅ Search functionality works without 404 errors
- ✅ Count updates correctly when search query changes

## Edge Cases Handled

1. ✅ **Multiple data sources with search**: Each gets its own count route
2. ✅ **Same data source, different perPage**: Count route created once, shared
3. ✅ **Pages without search**: Count route not created (unnecessary)
4. ✅ **Components**: Count route still created (backward compatible)
5. ✅ **Search-only (no pagination)**: No count route created (correct)

## Files Modified

- `packages/teleport-plugin-next-data-source/src/pagination-plugin.ts`:
  - `createAPIRoutesForPaginatedDataSources()`: Updated condition to create count routes for pages with search
  - Added `searchEnabledDataSources` Set
  - Added `createdCountRoutes` Set for deduplication
  - Changed `if (isComponent)` to `if (needsCountRoute)`

## Regression Prevention

This fix aligns with the comment on line 353 of the same file:
```typescript
// Add useEffect to refetch count when search changes (for both pages and components)
```

The useEffect was already being created for both pages and components, but the count API route was only being created for components. Now both are consistent.

## Related Issues

This issue was introduced when search functionality was added to pages. The original pagination implementation (without search) correctly didn't create count routes for pages because:
- Pages got initial count in `getStaticProps`
- Count never changed during user interaction (no search)

When search was added, the requirement changed:
- Count now needs to be refetched when search query changes
- But the count API route creation wasn't updated

## Future Considerations

If additional features are added that require dynamic count updates (e.g., filters, sorting), the same pattern should be followed:
1. Create the useEffect to refetch count
2. Ensure the count API route is created
3. Add the feature to the `searchEnabledDataSources` check (or create a new check)

