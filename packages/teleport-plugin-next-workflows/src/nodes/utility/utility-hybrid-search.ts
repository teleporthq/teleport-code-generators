import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_hybrid_search(config: any, context: Record<string, unknown>) {
  const query = config.query || ''
  const queryEmbedding = config.queryEmbedding || null
  const collection = config.documents || []
  const fields = config.fields || []
  const embeddingField = config.embeddingField || 'embedding'
  const topK = config.topK !== undefined ? Number(config.topK) : 10
  const textWeight = config.keywordWeight !== undefined ? Number(config.keywordWeight) : 0.5
  const semanticWeight = config.semanticWeight !== undefined ? Number(config.semanticWeight) : 0.5
  const fusionMethod = config.fusionMethod || 'rrf'
  const rrfK = config.rrfK !== undefined ? Number(config.rrfK) : 60

  if (!query) {
    return { results: [], error: 'No query provided' }
  }

  if (!collection || collection.length === 0) {
    return { results: [], error: 'Collection is empty' }
  }

  try {
    function fullTextScore(item: any, queryStr: string, searchFields: string[]): number {
      const queryLower = queryStr.toLowerCase()
      const terms = queryLower.split(/\s+/)
      let score = 0

      const fieldsToSearch = searchFields.length > 0 ? searchFields : Object.keys(item)
      for (let f = 0; f < fieldsToSearch.length; f++) {
        const val = item[fieldsToSearch[f]]
        if (val === undefined || val === null) {
          continue
        }
        const strVal = String(val).toLowerCase()

        if (strVal.indexOf(queryLower) !== -1) {
          score += 10
          if (strVal === queryLower) {
            score += 5
          }
        }

        for (let t = 0; t < terms.length; t++) {
          if (!terms[t]) {
            continue
          }
          if (strVal.indexOf(terms[t]) !== -1) {
            score += 1
            let idxPos = 0
            let count = 0
            let occurrenceIdx = strVal.indexOf(terms[t], idxPos)
            while (occurrenceIdx !== -1) {
              count++
              idxPos = occurrenceIdx + terms[t].length
              occurrenceIdx = strVal.indexOf(terms[t], idxPos)
            }
            score += Math.min(count - 1, 3) * 0.5
          }
        }
      }
      return score
    }

    function cosineSimilarity(vecA: number[], vecB: number[]): number {
      if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) {
        return 0
      }
      const len = Math.min(vecA.length, vecB.length)
      let dot = 0
      let mA = 0
      let mB = 0
      for (let i = 0; i < len; i++) {
        const a = vecA[i] || 0
        const b = vecB[i] || 0
        dot += a * b
        mA += a * a
        mB += b * b
      }
      mA = Math.sqrt(mA)
      mB = Math.sqrt(mB)
      if (mA === 0 || mB === 0) {
        return 0
      }
      return dot / (mA * mB)
    }

    const textScores: Array<{ index: number; score: number }> = []
    const semanticScores: Array<{ index: number; score: number }> = []
    let hasEmbeddings = false

    for (let i = 0; i < collection.length; i++) {
      const item = collection[i]

      const ts = fullTextScore(item, query, fields)
      textScores.push({ index: i, score: ts })

      if (queryEmbedding && item[embeddingField] && Array.isArray(item[embeddingField])) {
        hasEmbeddings = true
        const ss = cosineSimilarity(queryEmbedding, item[embeddingField])
        semanticScores.push({ index: i, score: ss })
      }
    }

    textScores.sort(function (a, b) {
      return b.score - a.score
    })
    semanticScores.sort(function (a, b) {
      return b.score - a.score
    })

    const finalScores: Record<number, number> = {}

    if (fusionMethod === 'rrf') {
      for (let ti = 0; ti < textScores.length; ti++) {
        if (textScores[ti].score <= 0) {
          continue
        }
        const idx = textScores[ti].index
        if (!finalScores[idx]) {
          finalScores[idx] = 0
        }
        finalScores[idx] += textWeight * (1 / (rrfK + ti + 1))
      }

      for (let si = 0; si < semanticScores.length; si++) {
        if (semanticScores[si].score <= 0) {
          continue
        }
        const idx = semanticScores[si].index
        if (!finalScores[idx]) {
          finalScores[idx] = 0
        }
        finalScores[idx] += semanticWeight * (1 / (rrfK + si + 1))
      }
    } else {
      let maxText = 0
      for (let mti = 0; mti < textScores.length; mti++) {
        if (textScores[mti].score > maxText) {
          maxText = textScores[mti].score
        }
      }
      let maxSem = 0
      for (let msi = 0; msi < semanticScores.length; msi++) {
        if (semanticScores[msi].score > maxSem) {
          maxSem = semanticScores[msi].score
        }
      }

      for (let nti = 0; nti < textScores.length; nti++) {
        const idx = textScores[nti].index
        const normalizedText = maxText > 0 ? textScores[nti].score / maxText : 0
        if (!finalScores[idx]) {
          finalScores[idx] = 0
        }
        finalScores[idx] += textWeight * normalizedText
      }

      for (let nsi = 0; nsi < semanticScores.length; nsi++) {
        const idx = semanticScores[nsi].index
        const normalizedSem = maxSem > 0 ? semanticScores[nsi].score / maxSem : 0
        if (!finalScores[idx]) {
          finalScores[idx] = 0
        }
        finalScores[idx] += semanticWeight * normalizedSem
      }
    }

    const ranked: Array<{ index: number; score: number }> = []
    const scoreKeys = Object.keys(finalScores)
    for (let sk = 0; sk < scoreKeys.length; sk++) {
      const scoreIdx = Number(scoreKeys[sk])
      if (finalScores[scoreIdx] > 0) {
        ranked.push({ index: scoreIdx, score: finalScores[scoreIdx] })
      }
    }

    ranked.sort(function (a, b) {
      return b.score - a.score
    })

    const results: any[] = []
    const limit = Math.min(ranked.length, topK)
    for (let ri = 0; ri < limit; ri++) {
      const resultItem = collection[ranked[ri].index]
      const cleaned: Record<string, any> = {}
      const keys = Object.keys(resultItem)
      for (let ck = 0; ck < keys.length; ck++) {
        if (keys[ck] !== embeddingField) {
          cleaned[keys[ck]] = resultItem[keys[ck]]
        }
      }
      results.push({ item: cleaned, score: Math.round(ranked[ri].score * 10000) / 10000 })
    }

    return {
      results,
      totalMatches: ranked.length,
      method: fusionMethod,
      hasSemanticScores: hasEmbeddings,
    }
  } catch (err: unknown) {
    return { results: [], error: (err as Error).message }
  }
}
export const utilityHybridSearch: NodeHandlerGenerator = {
  nodeType: 'utility-hybrid-search',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_hybrid_search)
  },
}
