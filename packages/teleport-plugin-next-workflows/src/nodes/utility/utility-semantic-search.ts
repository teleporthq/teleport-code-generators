import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_semantic_search(config: any, context: Record<string, unknown>) {
  const query = config.query || ''
  const queryEmbedding = config.queryEmbedding || null
  const collection = config.documents || []
  const embeddingField = config.embeddingField || 'embedding'
  const topK = config.topK !== undefined ? Number(config.topK) : 10
  const threshold = config.threshold !== undefined ? Number(config.threshold) : 0

  if (!query && !queryEmbedding) {
    return { results: [], error: 'No query or queryEmbedding provided' }
  }

  if (!collection || collection.length === 0) {
    return { results: [], error: 'Collection is empty' }
  }

  try {
    function cosineSimilarity(vecA: number[], vecB: number[]): number {
      if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) {
        return 0
      }
      const len = Math.min(vecA.length, vecB.length)
      let dotProduct = 0
      let magA = 0
      let magB = 0
      for (let i = 0; i < len; i++) {
        const a = vecA[i] || 0
        const b = vecB[i] || 0
        dotProduct += a * b
        magA += a * a
        magB += b * b
      }
      magA = Math.sqrt(magA)
      magB = Math.sqrt(magB)
      if (magA === 0 || magB === 0) {
        return 0
      }
      return dotProduct / (magA * magB)
    }

    let qEmb = queryEmbedding

    if (!qEmb) {
      function textToVector(textStr: string, wordIndex: Record<string, number>): number[] {
        const words = textStr
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
        const vec = new Array(Object.keys(wordIndex).length).fill(0)
        for (let i = 0; i < words.length; i++) {
          if (wordIndex[words[i]] !== undefined) {
            vec[wordIndex[words[i]]]++
          }
        }
        return vec
      }

      let hasEmbeddings = false
      for (let ci = 0; ci < collection.length; ci++) {
        if (collection[ci][embeddingField] && Array.isArray(collection[ci][embeddingField])) {
          hasEmbeddings = true
          break
        }
      }

      if (hasEmbeddings) {
        return {
          results: [],
          error:
            'Collection has embeddings but no queryEmbedding was provided. Generate a query embedding using the same model used for the collection.',
        }
      }

      const vocab: Record<string, number> = {}
      let vocabIdx = 0
      const searchFields = config.fields || []

      for (let vi = 0; vi < collection.length; vi++) {
        const item = collection[vi]
        const textFields = searchFields.length > 0 ? searchFields : Object.keys(item)
        for (let vf = 0; vf < textFields.length; vf++) {
          const fieldVal = item[textFields[vf]]
          if (typeof fieldVal !== 'string') {
            continue
          }
          const fieldWords = fieldVal
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
          for (let fw = 0; fw < fieldWords.length; fw++) {
            if (fieldWords[fw] && vocab[fieldWords[fw]] === undefined) {
              vocab[fieldWords[fw]] = vocabIdx++
            }
          }
        }
      }

      qEmb = textToVector(query, vocab)

      const sparseScored: any[] = []
      for (let si = 0; si < collection.length; si++) {
        const sItem = collection[si]
        let sText = ''
        const sFields = searchFields.length > 0 ? searchFields : Object.keys(sItem)
        for (let sf = 0; sf < sFields.length; sf++) {
          if (typeof sItem[sFields[sf]] === 'string') {
            sText += (sText ? ' ' : '') + sItem[sFields[sf]]
          }
        }
        const itemVec = textToVector(sText, vocab)
        const score = cosineSimilarity(qEmb, itemVec)
        if (score > threshold) {
          sparseScored.push({ item: sItem, score: Math.round(score * 10000) / 10000 })
        }
      }

      sparseScored.sort(function (a, b) {
        return b.score - a.score
      })
      const sparseTop = sparseScored.slice(0, topK)
      return { results: sparseTop, totalMatches: sparseScored.length }
    }

    const embeddingScored: any[] = []
    for (let ei = 0; ei < collection.length; ei++) {
      const eItem = collection[ei]
      const itemEmb = eItem[embeddingField]
      if (!itemEmb || !Array.isArray(itemEmb)) {
        continue
      }
      const score = cosineSimilarity(qEmb, itemEmb)
      if (score > threshold) {
        const resultItem: Record<string, any> = {}
        const itemKeys = Object.keys(eItem)
        for (let ek = 0; ek < itemKeys.length; ek++) {
          if (itemKeys[ek] !== embeddingField) {
            resultItem[itemKeys[ek]] = eItem[itemKeys[ek]]
          }
        }
        embeddingScored.push({ item: resultItem, score: Math.round(score * 10000) / 10000 })
      }
    }

    embeddingScored.sort(function (a, b) {
      return b.score - a.score
    })
    const embeddingTop = embeddingScored.slice(0, topK)
    return { results: embeddingTop, totalMatches: embeddingScored.length }
  } catch (err: unknown) {
    return { results: [], error: (err as Error).message }
  }
}
export const utilitySemanticSearch: NodeHandlerGenerator = {
  nodeType: 'utility-semantic-search',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_semantic_search)
  },
}
