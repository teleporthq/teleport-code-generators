import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_full_text_search(config: any, context: Record<string, unknown>) {
  const query = config.query || ''
  const collection = config.collection || []
  const fields = config.fields || []
  const fieldWeights = config.fieldWeights || {}
  const limit = config.limit !== undefined ? Number(config.limit) : 0
  const offset = config.offset !== undefined ? Number(config.offset) : 0
  const caseSensitive = config.caseSensitive || false
  const matchAll = config.matchAll || false
  const fuzzy = config.fuzzy || false
  const fuzzyThreshold = config.fuzzyThreshold !== undefined ? Number(config.fuzzyThreshold) : 0.7
  const stemming = config.stemming || false
  const removeStopWords = config.removeStopWords || false
  const highlight = config.highlight || false
  const highlightTag = config.highlightTag || 'mark'
  const prefixMatch = config.prefixMatch || false

  const emptyResult = { results: [], totalCount: 0, scores: [], queryTerms: [] }

  if (!query) {
    return emptyResult
  }

  if (!collection || collection.length === 0) {
    return emptyResult
  }

  try {
    /* ------------------------------------------------------------------ */
    /*  Helper: Levenshtein distance                                      */
    /* ------------------------------------------------------------------ */
    const levenshtein = function (a: string, b: string): number {
      const aLen = a.length
      const bLen = b.length
      if (aLen === 0) {
        return bLen
      }
      if (bLen === 0) {
        return aLen
      }

      const matrix: number[][] = []
      for (let i = 0; i <= aLen; i++) {
        matrix[i] = [i]
      }
      for (let j = 0; j <= bLen; j++) {
        matrix[0][j] = j
      }
      for (let i = 1; i <= aLen; i++) {
        for (let j = 1; j <= bLen; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + cost
          )
        }
      }
      return matrix[aLen][bLen]
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: fuzzy match check                                         */
    /* ------------------------------------------------------------------ */
    const fuzzyMatch = function (term: string, word: string): boolean {
      const dist = levenshtein(term, word)
      const maxLen = Math.max(term.length, word.length)
      if (maxLen === 0) {
        return true
      }
      const similarity = 1 - dist / maxLen
      return similarity >= fuzzyThreshold
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: basic Porter stemmer (common English suffixes)            */
    /* ------------------------------------------------------------------ */
    const stemWord = function (word: string): string {
      if (word.length < 3) {
        return word
      }
      const w = word

      // -tion -> t
      if (w.length > 4 && w.substring(w.length - 4) === 'tion') {
        return w.substring(0, w.length - 3)
      }

      // -ness
      if (w.length > 4 && w.substring(w.length - 4) === 'ness') {
        return w.substring(0, w.length - 4)
      }

      // -ment
      if (w.length > 4 && w.substring(w.length - 4) === 'ment') {
        return w.substring(0, w.length - 4)
      }

      // -ing
      if (w.length > 4 && w.substring(w.length - 3) === 'ing') {
        const stem = w.substring(0, w.length - 3)
        if (stem.length >= 2) {
          return stem
        }
      }

      // -est
      if (w.length > 4 && w.substring(w.length - 3) === 'est') {
        const stem = w.substring(0, w.length - 3)
        if (stem.length >= 2) {
          return stem
        }
      }

      // -ed
      if (w.length > 3 && w.substring(w.length - 2) === 'ed') {
        const stem = w.substring(0, w.length - 2)
        if (stem.length >= 2) {
          return stem
        }
      }

      // -er
      if (w.length > 3 && w.substring(w.length - 2) === 'er') {
        const stem = w.substring(0, w.length - 2)
        if (stem.length >= 2) {
          return stem
        }
      }

      // -ly
      if (w.length > 3 && w.substring(w.length - 2) === 'ly') {
        const stem = w.substring(0, w.length - 2)
        if (stem.length >= 2) {
          return stem
        }
      }

      // -s (but not -ss)
      if (w.length > 3 && w[w.length - 1] === 's' && w[w.length - 2] !== 's') {
        return w.substring(0, w.length - 1)
      }

      return w
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: stop words set                                            */
    /* ------------------------------------------------------------------ */
    const stopWordsArr = [
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'and',
      'or',
      'but',
      'not',
      'with',
      'by',
      'this',
      'that',
      'it',
      'from',
      'as',
      'be',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'can',
      'may',
      'might',
    ]
    const stopWordsSet: Record<string, boolean> = {}
    for (let sw = 0; sw < stopWordsArr.length; sw++) {
      stopWordsSet[stopWordsArr[sw]] = true
    }

    const isStopWord = function (word: string): boolean {
      return stopWordsSet[word.toLowerCase()] === true
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: check if a term matches a word (substring, prefix, fuzzy) */
    /* ------------------------------------------------------------------ */
    const termMatchesWord = function (term: string, word: string): boolean {
      // Exact / substring
      if (word.indexOf(term) !== -1) {
        return true
      }
      // Prefix match
      if (prefixMatch && word.indexOf(term) === 0) {
        return true
      }
      // Fuzzy match
      if (fuzzy && fuzzyMatch(term, word)) {
        return true
      }
      return false
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: check if a term appears in a field string value           */
    /* ------------------------------------------------------------------ */
    const termFoundInValue = function (term: string, strValue: string, words: string[]): boolean {
      // Direct substring check
      if (strValue.indexOf(term) !== -1) {
        return true
      }
      // Prefix or fuzzy require word-level checks
      if (prefixMatch || fuzzy) {
        for (let w = 0; w < words.length; w++) {
          if (termMatchesWord(term, words[w])) {
            return true
          }
        }
      }
      return false
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: count term occurrences in words array                     */
    /* ------------------------------------------------------------------ */
    const countTermInWords = function (term: string, words: string[]): number {
      let count = 0
      for (let w = 0; w < words.length; w++) {
        if (termMatchesWord(term, words[w])) {
          count++
        }
      }
      return count
    }

    /* ------------------------------------------------------------------ */
    /*  Helper: highlight matches in a string                             */
    /* ------------------------------------------------------------------ */
    const highlightMatches = function (originalValue: string, terms: string[]): string {
      let result = originalValue
      for (let t = 0; t < terms.length; t++) {
        const term = terms[t]
        const lowerResult = caseSensitive ? result : result.toLowerCase()
        const lowerTerm = caseSensitive ? term : term.toLowerCase()
        let built = ''
        let searchFrom = 0

        while (true) {
          const idx = lowerResult.indexOf(lowerTerm, searchFrom)
          if (idx === -1) {
            built = built + result.substring(searchFrom)
            break
          }
          built = built + result.substring(searchFrom, idx)
          const openTag = '<' + highlightTag + '>'
          const closeTag = '</' + highlightTag + '>'
          built = built + openTag + result.substring(idx, idx + term.length) + closeTag
          searchFrom = idx + term.length
        }

        result = built
      }
      return result
    }

    /* ------------------------------------------------------------------ */
    /*  Process query terms                                               */
    /* ------------------------------------------------------------------ */
    const queryStr = caseSensitive ? query : query.toLowerCase()
    const rawTerms = queryStr.split(/\s+/).filter(function (t: string) {
      return t.length > 0
    })

    // Remove stop words if configured
    let filteredTerms: string[] = []
    if (removeStopWords) {
      for (let rt = 0; rt < rawTerms.length; rt++) {
        if (!isStopWord(rawTerms[rt])) {
          filteredTerms.push(rawTerms[rt])
        }
      }
    } else {
      filteredTerms = rawTerms.slice()
    }

    // Apply stemming if configured
    let queryTerms: string[] = []
    if (stemming) {
      for (let st = 0; st < filteredTerms.length; st++) {
        queryTerms.push(stemWord(filteredTerms[st]))
      }
    } else {
      queryTerms = filteredTerms.slice()
    }

    if (queryTerms.length === 0) {
      return { results: [], totalCount: 0, scores: [], queryTerms }
    }

    /* ------------------------------------------------------------------ */
    /*  Pre-compute document field data for TF-IDF                        */
    /* ------------------------------------------------------------------ */
    // For each document, build a words array per field
    const docFieldData: Array<{
      searchFields: string[]
      fieldWords: Record<string, string[]>
      fieldStrValues: Record<string, string>
      originalFieldValues: Record<string, string>
      totalWords: number
    }> = []

    for (let i = 0; i < collection.length; i++) {
      const item = collection[i]
      const searchFields = fields.length > 0 ? fields : Object.keys(item)
      const fieldWords: Record<string, string[]> = {}
      const fieldStrValues: Record<string, string> = {}
      const originalFieldValues: Record<string, string> = {}
      let totalWords = 0

      for (let f = 0; f < searchFields.length; f++) {
        const fieldName = searchFields[f]
        const fieldValue = item[fieldName]
        if (fieldValue === undefined || fieldValue === null) {
          continue
        }

        const origStr = String(fieldValue)
        const strValue = caseSensitive ? origStr : origStr.toLowerCase()
        originalFieldValues[fieldName] = origStr
        fieldStrValues[fieldName] = strValue

        let words = strValue.split(/\s+/).filter(function (w: string) {
          return w.length > 0
        })
        if (stemming) {
          const stemmedWords: string[] = []
          for (let sw = 0; sw < words.length; sw++) {
            stemmedWords.push(stemWord(words[sw]))
          }
          words = stemmedWords
        }
        fieldWords[fieldName] = words
        totalWords += words.length
      }

      docFieldData.push({
        searchFields,
        fieldWords,
        fieldStrValues,
        originalFieldValues,
        totalWords,
      })
    }

    /* ------------------------------------------------------------------ */
    /*  Compute IDF for each query term                                   */
    /* ------------------------------------------------------------------ */
    const totalDocs = collection.length
    const idfMap: Record<string, number> = {}

    for (let t = 0; t < queryTerms.length; t++) {
      const term = queryTerms[t]
      let docsContaining = 0

      for (let d = 0; d < docFieldData.length; d++) {
        const docData = docFieldData[d]
        let found = false

        for (let f = 0; f < docData.searchFields.length; f++) {
          const fn = docData.searchFields[f]
          const words = docData.fieldWords[fn]
          if (!words) {
            continue
          }

          if (termFoundInValue(term, docData.fieldStrValues[fn] || '', words)) {
            found = true
            break
          }
        }

        if (found) {
          docsContaining++
        }
      }

      // IDF = log(totalDocs / docsContaining), with smoothing to avoid division by zero
      if (docsContaining > 0) {
        idfMap[term] = Math.log(totalDocs / docsContaining)
      } else {
        idfMap[term] = 0
      }
    }

    /* ------------------------------------------------------------------ */
    /*  Score each document using TF-IDF                                  */
    /* ------------------------------------------------------------------ */
    const scored: Array<{ item: any; score: number; highlights: Record<string, string> }> = []

    for (let i = 0; i < collection.length; i++) {
      const item = collection[i]
      const docData = docFieldData[i]
      let totalScore = 0
      let termsFound = 0
      const highlightData: Record<string, string> = {}
      const matchedTermsForHighlight: string[] = []

      for (let t = 0; t < queryTerms.length; t++) {
        const term = queryTerms[t]
        let termFoundAnywhere = false

        for (let f = 0; f < docData.searchFields.length; f++) {
          const fieldName: any = docData.searchFields[f]
          const words = docData.fieldWords[fieldName]
          if (!words) {
            continue
          }

          const strValue = docData.fieldStrValues[fieldName] || ''
          const weight = fieldWeights[fieldName] !== undefined ? Number(fieldWeights[fieldName]) : 1

          // Count term frequency in this field
          const termCount = countTermInWords(term, words)

          if (termCount > 0) {
            termFoundAnywhere = true

            // TF = term frequency in document / total terms in document
            const tf = docData.totalWords > 0 ? termCount / docData.totalWords : 0

            // TF-IDF score contribution for this term in this field
            const idf = idfMap[term] || 0
            totalScore += tf * idf * weight
          }
        }

        if (termFoundAnywhere) {
          termsFound++
          matchedTermsForHighlight.push(term)
        }
      }

      if (matchAll && termsFound < queryTerms.length) {
        continue
      }

      if (totalScore > 0) {
        // Build highlights if enabled
        if (highlight) {
          for (let f = 0; f < docData.searchFields.length; f++) {
            const fieldName: any = docData.searchFields[f]
            const origValue = docData.originalFieldValues[fieldName]
            if (!origValue) {
              continue
            }

            // Use original (un-stemmed) filtered terms for highlighting
            const highlightTermsToUse = filteredTerms
            const highlighted = highlightMatches(origValue, highlightTermsToUse)
            if (highlighted !== origValue) {
              highlightData[fieldName] = highlighted
            }
          }
        }

        scored.push({ item, score: totalScore, highlights: highlightData })
      }
    }

    /* ------------------------------------------------------------------ */
    /*  Sort by score descending                                          */
    /* ------------------------------------------------------------------ */
    scored.sort(function (a, b) {
      return b.score - a.score
    })
    const totalCount = scored.length

    /* ------------------------------------------------------------------ */
    /*  Pagination                                                        */
    /* ------------------------------------------------------------------ */
    const start = offset
    const end = limit > 0 ? Math.min(start + limit, scored.length) : scored.length
    const paged = scored.slice(start, end)

    /* ------------------------------------------------------------------ */
    /*  Build result arrays                                               */
    /* ------------------------------------------------------------------ */
    const results: any[] = []
    const scores: number[] = []
    for (let r = 0; r < paged.length; r++) {
      const entry = paged[r]
      if (highlight && Object.keys(entry.highlights).length > 0) {
        const itemCopy: any = {}
        const keys = Object.keys(entry.item)
        for (let k = 0; k < keys.length; k++) {
          itemCopy[keys[k]] = entry.item[keys[k]]
        }
        itemCopy._highlights = entry.highlights
        results.push(itemCopy)
      } else {
        results.push(entry.item)
      }
      scores.push(entry.score)
    }

    return {
      results,
      totalCount,
      scores,
      queryTerms,
    }
  } catch (err: unknown) {
    return { results: [], totalCount: 0, scores: [], queryTerms: [], error: (err as Error).message }
  }
}
export const utilityFullTextSearch: NodeHandlerGenerator = {
  nodeType: 'utility-full-text-search',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_full_text_search)
  },
}
