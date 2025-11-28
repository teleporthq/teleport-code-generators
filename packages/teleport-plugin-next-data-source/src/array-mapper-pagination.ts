import { UIDLElementNode, UIDLNode } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'

export interface ArrayMapperPaginationInfo {
  paginationNodeId: string
  dataSourceIdentifier: string
  pageStateVar: string
  setPageStateVar: string
  hasPrevPageVar: string
  hasNextPageVar: string
  paginatedDataVar: string
  totalPagesVar: string
  perPage: number
  searchEnabled?: boolean
  searchDebounce?: number
  searchQueryVar?: string
  setSearchQueryVar?: string
  debouncedSearchQueryVar?: string
  setDebouncedSearchQueryVar?: string
  queryColumns?: string[]
}

export interface PaginationNodeInfo {
  paginationNode: UIDLElementNode
  dataSourceIdentifier: string
  perPage: number
  prevButton: UIDLElementNode | null
  nextButton: UIDLElementNode | null
}

export function findPaginationNodes(uidl: UIDLNode): PaginationNodeInfo[] {
  const result: PaginationNodeInfo[] = []
  const dataSourcesFound: string[] = []

  UIDLUtils.traverseNodes(uidl, (node) => {
    if (node.type === 'data-source-list' && node.content.renderPropIdentifier) {
      dataSourcesFound.push(node.content.renderPropIdentifier)
    }

    if (node.type === 'element' && node.content.elementType === 'cms-pagination-node') {
      const paginationNode = node as UIDLElementNode
      let prevButton: UIDLElementNode | null = null
      let nextButton: UIDLElementNode | null = null

      UIDLUtils.traverseNodes(paginationNode, (childNode) => {
        if (
          childNode.type === 'element' &&
          childNode.content.elementType === 'cms-navigation-button'
        ) {
          const buttonName = childNode.content.name?.toLowerCase() || ''
          if (buttonName.includes('prev')) {
            prevButton = childNode as UIDLElementNode
          } else {
            nextButton = childNode as UIDLElementNode
          }
        }
      })

      const dataSourceIdentifier = dataSourcesFound[dataSourcesFound.length - 1]

      if (dataSourceIdentifier && (prevButton || nextButton)) {
        result.push({
          paginationNode,
          dataSourceIdentifier,
          perPage: 10,
          prevButton,
          nextButton,
        })
      }
    }
  })

  return result
}

export function generatePaginationLogic(
  paginationNodeId: string,
  dataSourceIdentifier: string,
  perPage: number = 10,
  searchConfig?: { searchEnabled: boolean; searchDebounce: number },
  queryColumns?: string[]
): ArrayMapperPaginationInfo {
  const safeId = paginationNodeId.replace(/[^a-zA-Z0-9_]/g, '_')
  const pageStateVar = `pagination_${safeId}_page`
  const setPageStateVar = `setPagination_${safeId}_page`
  const hasPrevPageVar = `pagination_${safeId}_hasPrevPage`
  const hasNextPageVar = `pagination_${safeId}_hasNextPage`
  const paginatedDataVar = `pagination_${safeId}_paginatedData`
  const totalPagesVar = `pagination_${safeId}_totalPages`
  const searchQueryVar = `search_${safeId}_query`
  const setSearchQueryVar = `setSearch_${safeId}_query`
  const debouncedSearchQueryVar = `debouncedSearch_${safeId}_query`
  const setDebouncedSearchQueryVar = `setDebouncedSearch_${safeId}_query`

  return {
    paginationNodeId,
    dataSourceIdentifier,
    pageStateVar,
    setPageStateVar,
    hasPrevPageVar,
    hasNextPageVar,
    paginatedDataVar,
    totalPagesVar,
    perPage,
    searchEnabled: searchConfig?.searchEnabled,
    searchDebounce: searchConfig?.searchDebounce,
    searchQueryVar,
    setSearchQueryVar,
    debouncedSearchQueryVar,
    setDebouncedSearchQueryVar,
    queryColumns,
  }
}
