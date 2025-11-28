import { generatePaginationLogic } from '../src/array-mapper-pagination'

describe('Array Mapper Pagination', () => {
  describe('generatePaginationLogic', () => {
    it('should generate pagination info with correct variable names', () => {
      const result = generatePaginationLogic('TQ_mapper_123', 'testData', 10)

      expect(result.paginationNodeId).toBe('TQ_mapper_123')
      expect(result.dataSourceIdentifier).toBe('testData')
      expect(result.pageStateVar).toBe('pagination_TQ_mapper_123_page')
      expect(result.setPageStateVar).toBe('setPagination_TQ_mapper_123_page')
      expect(result.hasPrevPageVar).toBe('pagination_TQ_mapper_123_hasPrevPage')
      expect(result.hasNextPageVar).toBe('pagination_TQ_mapper_123_hasNextPage')
      expect(result.paginatedDataVar).toBe('pagination_TQ_mapper_123_paginatedData')
      expect(result.totalPagesVar).toBe('pagination_TQ_mapper_123_totalPages')
      expect(result.perPage).toBe(10)
    })

    it('should use default perPage of 10', () => {
      const result = generatePaginationLogic('TQ_mapper_456', 'data')

      expect(result.perPage).toBe(10)
    })

    it('should sanitize special characters in IDs', () => {
      const result = generatePaginationLogic('TQ-mapper.test@123', 'data')

      expect(result.pageStateVar).toBe('pagination_TQ_mapper_test_123_page')
    })
  })
})
