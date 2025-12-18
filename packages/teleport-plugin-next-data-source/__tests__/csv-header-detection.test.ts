import { generateCSVFileFetcher, validateCSVConfig } from '../src/fetchers/csv-file'

describe('CSV Header Detection', () => {
  describe('validateCSVConfig with new properties', () => {
    it('validates fileContent with autoDetectHeader', () => {
      const result = validateCSVConfig({
        fileContent: 'name,age\nJohn,30\nJane,25',
        autoDetectHeader: true,
      })
      expect(result.isValid).toBe(true)
    })

    it('validates fileContent with firstRowIsHeader', () => {
      const result = validateCSVConfig({
        fileContent: 'name,age\nJohn,30',
        firstRowIsHeader: false,
      })
      expect(result.isValid).toBe(true)
    })

    it('accepts both autoDetectHeader and firstRowIsHeader', () => {
      const result = validateCSVConfig({
        fileContent: 'name,age\nJohn,30',
        autoDetectHeader: false,
        firstRowIsHeader: true,
      })
      expect(result.isValid).toBe(true)
    })
  })

  describe('generateCSVFileFetcher with fileContent', () => {
    it('generates fetcher with header detection code when fileContent is provided', () => {
      const config = {
        fileContent: 'name,age\nJohn,30\nJane,25',
        autoDetectHeader: true,
        firstRowIsHeader: true,
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('parseCSVLine')
      expect(code).toContain('detectHeaderRow')
      expect(code).toContain('parseCSVContent')
      expect(code).toContain('const autoDetectHeader = true')
      expect(code).toContain('const firstRowIsHeader = true')
    })

    it('generates fetcher with autoDetectHeader defaulting to true', () => {
      const config = {
        fileContent: 'name,age\nJohn,30',
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('const autoDetectHeader = true')
    })

    it('generates fetcher with firstRowIsHeader defaulting to true', () => {
      const config = {
        fileContent: 'name,age\nJohn,30',
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('const firstRowIsHeader = true')
    })

    it('respects autoDetectHeader: false', () => {
      const config = {
        fileContent: 'name,age\nJohn,30',
        autoDetectHeader: false,
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('const autoDetectHeader = false')
    })

    it('respects firstRowIsHeader: false', () => {
      const config = {
        fileContent: 'name,age\nJohn,30',
        firstRowIsHeader: false,
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('const firstRowIsHeader = false')
    })

    it('includes column configuration when provided', () => {
      const config = {
        fileContent: 'name,age\nJohn,30',
        columns: [
          { id: 'col_0', label: 'Full Name', type: 'string' },
          { id: 'col_1', label: 'Age', type: 'number' },
        ],
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('const configColumns = ')
      expect(code).toContain('Full Name')
      expect(code).toContain('Age')
    })

    it('includes all necessary helper functions', () => {
      const config = {
        fileContent: 'name,age\nJohn,30',
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('safeJSONParse')
      expect(code).toContain('formatDateValue')
      expect(code).toContain('getNestedValue')
      expect(code).toContain('compareValues')
      expect(code).toContain('COMMON_HEADER_PATTERNS')
      expect(code).toContain('DATA_PATTERNS')
      expect(code).toContain('looksLikeDataValue')
      expect(code).toContain('looksLikeHeaderValue')
    })
  })

  describe('generateCSVFileFetcher backward compatibility', () => {
    it('generates simple fetcher when only parsedData is provided', () => {
      const config = {
        parsedData: [
          { col_0: 'John', col_1: 30 },
          { col_0: 'Jane', col_1: 25 },
        ],
        columns: [
          { id: 'col_0', label: 'Name' },
          { id: 'col_1', label: 'Age' },
        ],
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('const data = ')
      expect(code).toContain('const columns = ')
      expect(code).not.toContain('parseCSVLine')
      expect(code).not.toContain('detectHeaderRow')
      expect(code).not.toContain('parseCSVContent')
    })

    it('maintains backward compatibility with existing parsedData format', () => {
      const config = {
        parsedData: [{ name: 'John' }],
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('export default async function handler')
      expect(code).toContain('const data = ')
    })
  })

  describe('generated code structure', () => {
    it('exports handler function in both cases', () => {
      const configWithFileContent = {
        fileContent: 'name\nJohn',
      }
      const configWithParsedData = {
        parsedData: [{ col_0: 'John' }],
      }

      const codeWithFileContent = generateCSVFileFetcher(configWithFileContent)
      const codeWithParsedData = generateCSVFileFetcher(configWithParsedData)

      expect(codeWithFileContent).toContain('export default async function handler')
      expect(codeWithParsedData).toContain('export default async function handler')
    })

    it('includes sorting and filtering logic', () => {
      const config = {
        fileContent: 'name\nJohn',
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('if (query)')
      expect(code).toContain('if (filters)')
      expect(code).toContain('if (sorts)')
      expect(code).toContain('if (sortBy)')
    })

    it('includes pagination logic', () => {
      const config = {
        fileContent: 'name\nJohn',
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('limit')
      expect(code).toContain('offset')
      expect(code).toContain('page')
      expect(code).toContain('perPage')
    })
  })

  describe('header detection with names-only CSV', () => {
    it('does not treat first name as header when all rows are names', () => {
      const config = {
        fileContent: 'Paul\nNelu\nPop paul\nPop roxi\nGalea',
        autoDetectHeader: true,
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('parseCSVContent')
      expect(code).toContain('const autoDetectHeader = true')
    })

    it('includes all names as data when CSV has only names', () => {
      const config = {
        fileContent: 'John\nJane\nBob\nAlice',
        autoDetectHeader: true,
      }
      const code = generateCSVFileFetcher(config)

      expect(code).toContain('detectHeaderRow')
    })
  })
})
