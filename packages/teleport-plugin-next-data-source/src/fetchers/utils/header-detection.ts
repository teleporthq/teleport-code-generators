export const generateHeaderDetectionCode = (): string => {
  return `const COMMON_HEADER_PATTERNS = [
  /^id$/i,
  /^name$/i,
  /^email$/i,
  /^date$/i,
  /^time$/i,
  /^status$/i,
  /^type$/i,
  /^title$/i,
  /^description$/i,
  /^price$/i,
  /^amount$/i,
  /^quantity$/i,
  /^total$/i,
  /^url$/i,
  /^link$/i,
  /^image$/i,
  /^phone$/i,
  /^address$/i,
  /^city$/i,
  /^country$/i,
  /^category$/i,
  /^tag$/i,
  /^created/i,
  /^updated/i,
  /^modified/i,
  /_id$/i,
  /_at$/i,
  /_date$/i,
  /_name$/i,
  /_url$/i,
]

const DATA_PATTERNS = {
  email: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/,
  url: /^https?:\\/\\//i,
  phone: /^[+]?[\\d\\s()-]{7,}$/,
  date: /^\\d{1,4}[-/]\\d{1,2}[-/]\\d{1,4}$/,
  currency: /^[$€£¥]\\s*[\\d,]+\\.?\\d*$/,
  percentage: /^\\d+\\.?\\d*%$/,
  pureNumber: /^-?\\d+\\.?\\d*$/,
}

function looksLikeDataValue(val) {
  if (val === null || val === undefined) {
    return false
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return true
  }
  if (val instanceof Date) {
    return true
  }
  if (typeof val === 'string') {
    const str = val.trim()
    return Object.values(DATA_PATTERNS).some((pattern) => pattern.test(str))
  }
  return false
}

function looksLikeHeaderValue(val) {
  if (typeof val !== 'string') {
    return false
  }
  const str = val.trim()
  if (str.length === 0 || str.length > 50) {
    return false
  }
  if (looksLikeDataValue(str)) {
    return false
  }
  if (COMMON_HEADER_PATTERNS.some((pattern) => pattern.test(str))) {
    return true
  }
  const isTitleCase = /^[A-Z][a-z]*(\\s+[A-Z][a-z]*)*$/.test(str)
  const isSnakeCase = /^[a-z]+(_[a-z]+)*$/i.test(str)
  const isCamelCase = /^[a-z]+([A-Z][a-z]*)*$/.test(str)
  const isPascalCase = /^[A-Z][a-z]+([A-Z][a-z]*)*$/.test(str)
  const isUpperCase = /^[A-Z][A-Z\\s_]+$/.test(str) && str.length > 1
  return isTitleCase || isSnakeCase || isCamelCase || isPascalCase || isUpperCase
}

function detectHeaderRow(
  firstRowValues,  
  allRows,
  minConfidenceScore = 4
) {
  if (allRows.length < 2) {
    return false
  }

  // Helper to extract values from a row (handles both CSV arrays and Google Sheets objects)
  const getRowValues = (row) => {
    if (Array.isArray(row)) {
      return row
    }
    // Google Sheets format: row has a 'c' property with cells
    if (row && row.c && Array.isArray(row.c)) {
      return row.c.map((cell) => cell?.v ?? cell?.f ?? null)
    }
    return []
  }

  const nonEmptyFirstRowValues = firstRowValues.filter(
    (v) => v !== null && v !== undefined && v !== ''
  )
  if (nonEmptyFirstRowValues.length === 0) {
    return false
  }

  let score = 0

  const allStrings = nonEmptyFirstRowValues.every((val) => typeof val === 'string')
  if (allStrings) {
    score += 1
  } else {
    return false
  }

  const hasUniqueValues =
    nonEmptyFirstRowValues.length ===
    new Set(nonEmptyFirstRowValues.map((v) => String(v).toLowerCase().trim())).size
  if (hasUniqueValues) {
    score += 1
  }

  const headerLikeCount = nonEmptyFirstRowValues.filter((v) => looksLikeHeaderValue(v)).length
  const headerLikeRatio = headerLikeCount / nonEmptyFirstRowValues.length
  if (headerLikeRatio >= 0.5) {
    score += 2
  } else if (headerLikeRatio >= 0.3) {
    score += 1
  }

  const commonHeaderCount = nonEmptyFirstRowValues.filter((v) =>
    COMMON_HEADER_PATTERNS.some((pattern) => pattern.test(String(v).trim()))
  ).length
  if (commonHeaderCount >= 2) {
    score += 2
  } else if (commonHeaderCount >= 1) {
    score += 1
  }

  const dataLikeInFirstRow = nonEmptyFirstRowValues.filter((v) => looksLikeDataValue(v)).length
  if (dataLikeInFirstRow > 0) {
    score -= dataLikeInFirstRow * 2
  }

  const sampleSize = Math.min(5, allRows.length - 1)
  let dataRowsWithDataPatterns = 0
  for (let i = 1; i <= sampleSize; i++) {
    const rowValues = getRowValues(allRows[i])
    const hasDataPattern = rowValues.some((v) => looksLikeDataValue(v))
    if (hasDataPattern) {
      dataRowsWithDataPatterns++
    }
  }
  if (dataRowsWithDataPatterns >= sampleSize * 0.6) {
    score += 2
  }

  const firstRowTypesSet = new Set(nonEmptyFirstRowValues.map((v) => typeof v))
  const secondRowValues = getRowValues(allRows[1]).filter((v) => v !== null && v !== undefined && v !== '')
  const secondRowTypesSet = new Set(secondRowValues.map((v) => typeof v))

  const firstRowOnlyStrings = firstRowTypesSet.size === 1 && firstRowTypesSet.has('string')
  const secondRowHasOtherTypes = secondRowTypesSet.has('number') || secondRowTypesSet.has('boolean')
  if (firstRowOnlyStrings && secondRowHasOtherTypes) {
    score += 2
  }

  const firstRowSimilarToDataRows = nonEmptyFirstRowValues.some((v) => looksLikeDataValue(v))
  const secondRowHasData = secondRowValues.some((v) => looksLikeDataValue(v))
  if (firstRowSimilarToDataRows && secondRowHasData) {
    score -= 2
  }

  // Check if subsequent rows also look like headers
  // If they do, the first row is likely data, not a header
  const subsequentRowsSample = Math.min(3, allRows.length - 1)
  let subsequentHeaderLikeCount = 0
  for (let i = 1; i <= subsequentRowsSample; i++) {
    const rowValues = getRowValues(allRows[i]).filter((v) => v !== null && v !== undefined && v !== '')
    if (rowValues.length > 0) {
      const headerLikeInRow = rowValues.filter((v) => looksLikeHeaderValue(v)).length
      const headerLikeRatioInRow = headerLikeInRow / rowValues.length
      if (headerLikeRatioInRow >= 0.5) {
        subsequentHeaderLikeCount++
      }
    }
  }
  // If most subsequent rows also look like headers, first row is probably data
  if (subsequentHeaderLikeCount >= subsequentRowsSample * 0.6) {
    score -= 4
  }

  return score >= minConfidenceScore
}`
}
