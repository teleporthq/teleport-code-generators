import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_similarity_scoring(config: any, context: Record<string, unknown>) {
  const text1 = config.text1 || ''
  const text2 = config.text2 || ''
  const algorithm = config.algorithm || 'levenshtein'

  if (!text1 && !text2) {
    return { score: algorithm === 'levenshtein' ? 1 : 0, algorithm }
  }

  try {
    let score = 0

    switch (algorithm) {
      case 'levenshtein': {
        const s1 = text1.toLowerCase()
        const s2 = text2.toLowerCase()

        if (s1 === s2) {
          score = 1
          break
        }
        if (s1.length === 0) {
          score = 0
          break
        }
        if (s2.length === 0) {
          score = 0
          break
        }

        const matrix: number[][] = []
        for (let li = 0; li <= s1.length; li++) {
          matrix[li] = [li]
        }
        for (let lj = 0; lj <= s2.length; lj++) {
          matrix[0][lj] = lj
        }
        for (let mi = 1; mi <= s1.length; mi++) {
          for (let mj = 1; mj <= s2.length; mj++) {
            const cost = s1.charAt(mi - 1) === s2.charAt(mj - 1) ? 0 : 1
            matrix[mi][mj] = Math.min(
              matrix[mi - 1][mj] + 1,
              matrix[mi][mj - 1] + 1,
              matrix[mi - 1][mj - 1] + cost
            )
          }
        }
        const distance = matrix[s1.length][s2.length]
        const maxLen = Math.max(s1.length, s2.length)
        score = maxLen === 0 ? 1 : 1 - distance / maxLen
        break
      }
      case 'jaccard': {
        const jWords1 = text1.toLowerCase().split(/\s+/)
        const jWords2 = text2.toLowerCase().split(/\s+/)
        const set1: Record<string, boolean> = {}
        const set2: Record<string, boolean> = {}
        for (let jw1 = 0; jw1 < jWords1.length; jw1++) {
          if (jWords1[jw1]) {
            set1[jWords1[jw1]] = true
          }
        }
        for (let jw2 = 0; jw2 < jWords2.length; jw2++) {
          if (jWords2[jw2]) {
            set2[jWords2[jw2]] = true
          }
        }
        let intersection = 0
        const keys1 = Object.keys(set1)
        for (let jk = 0; jk < keys1.length; jk++) {
          if (set2[keys1[jk]]) {
            intersection++
          }
        }
        const unionSize = Object.keys(set1).length + Object.keys(set2).length - intersection
        score = unionSize === 0 ? 0 : intersection / unionSize
        break
      }
      case 'cosine': {
        const cWords1 = text1.toLowerCase().split(/\s+/)
        const cWords2 = text2.toLowerCase().split(/\s+/)
        const vec1: Record<string, number> = {}
        const vec2: Record<string, number> = {}
        for (let cv1 = 0; cv1 < cWords1.length; cv1++) {
          if (cWords1[cv1]) {
            vec1[cWords1[cv1]] = (vec1[cWords1[cv1]] || 0) + 1
          }
        }
        for (let cv2 = 0; cv2 < cWords2.length; cv2++) {
          if (cWords2[cv2]) {
            vec2[cWords2[cv2]] = (vec2[cWords2[cv2]] || 0) + 1
          }
        }
        const allWords: Record<string, boolean> = {}
        const vk1 = Object.keys(vec1)
        const vk2 = Object.keys(vec2)
        for (let ak1 = 0; ak1 < vk1.length; ak1++) {
          allWords[vk1[ak1]] = true
        }
        for (let ak2 = 0; ak2 < vk2.length; ak2++) {
          allWords[vk2[ak2]] = true
        }
        const allKeys = Object.keys(allWords)
        let dotProduct = 0
        let mag1 = 0
        let mag2 = 0
        for (let aw = 0; aw < allKeys.length; aw++) {
          const val1 = vec1[allKeys[aw]] || 0
          const val2 = vec2[allKeys[aw]] || 0
          dotProduct += val1 * val2
          mag1 += val1 * val1
          mag2 += val2 * val2
        }
        mag1 = Math.sqrt(mag1)
        mag2 = Math.sqrt(mag2)
        score = mag1 === 0 || mag2 === 0 ? 0 : dotProduct / (mag1 * mag2)
        break
      }
      case 'dice': {
        const dWords1 = text1.toLowerCase().split(/\s+/)
        const dWords2 = text2.toLowerCase().split(/\s+/)
        const dSet1: Record<string, boolean> = {}
        const dSet2: Record<string, boolean> = {}
        for (let dw1 = 0; dw1 < dWords1.length; dw1++) {
          if (dWords1[dw1]) {
            dSet1[dWords1[dw1]] = true
          }
        }
        for (let dw2 = 0; dw2 < dWords2.length; dw2++) {
          if (dWords2[dw2]) {
            dSet2[dWords2[dw2]] = true
          }
        }
        let dIntersection = 0
        const dKeys = Object.keys(dSet1)
        for (let dk = 0; dk < dKeys.length; dk++) {
          if (dSet2[dKeys[dk]]) {
            dIntersection++
          }
        }
        const dTotal = Object.keys(dSet1).length + Object.keys(dSet2).length
        score = dTotal === 0 ? 0 : (2 * dIntersection) / dTotal
        break
      }
      case 'hamming': {
        const h1 = text1.toLowerCase()
        const h2 = text2.toLowerCase()
        if (h1.length !== h2.length) {
          return {
            score: 0,
            algorithm,
            error: 'Hamming distance requires strings of equal length',
          }
        }
        let hMatches = 0
        for (let hi = 0; hi < h1.length; hi++) {
          if (h1.charAt(hi) === h2.charAt(hi)) {
            hMatches++
          }
        }
        score = h1.length === 0 ? 1 : hMatches / h1.length
        break
      }
      case 'jaro-winkler': {
        const jw1str = text1.toLowerCase()
        const jw2str = text2.toLowerCase()

        if (jw1str === jw2str) {
          score = 1
          break
        }
        if (jw1str.length === 0 || jw2str.length === 0) {
          score = 0
          break
        }

        let matchWindow = Math.floor(Math.max(jw1str.length, jw2str.length) / 2) - 1
        if (matchWindow < 0) {
          matchWindow = 0
        }
        const jw1Matches = new Array(jw1str.length).fill(false)
        const jw2Matches = new Array(jw2str.length).fill(false)
        let matches = 0
        let transpositions = 0

        for (let ji = 0; ji < jw1str.length; ji++) {
          const start = Math.max(0, ji - matchWindow)
          const end = Math.min(ji + matchWindow + 1, jw2str.length)
          for (let jj = start; jj < end; jj++) {
            if (jw2Matches[jj] || jw1str.charAt(ji) !== jw2str.charAt(jj)) {
              continue
            }
            jw1Matches[ji] = true
            jw2Matches[jj] = true
            matches++
            break
          }
        }

        if (matches === 0) {
          score = 0
          break
        }

        let jk = 0
        for (let jti = 0; jti < jw1str.length; jti++) {
          if (!jw1Matches[jti]) {
            continue
          }
          while (!jw2Matches[jk]) {
            jk++
          }
          if (jw1str.charAt(jti) !== jw2str.charAt(jk)) {
            transpositions++
          }
          jk++
        }

        const jaro =
          (matches / jw1str.length +
            matches / jw2str.length +
            (matches - transpositions / 2) / matches) /
          3

        let prefix = 0
        const maxPrefix = Math.min(4, Math.min(jw1str.length, jw2str.length))
        for (let jp = 0; jp < maxPrefix; jp++) {
          if (jw1str.charAt(jp) === jw2str.charAt(jp)) {
            prefix++
          } else {
            break
          }
        }

        score = jaro + prefix * 0.1 * (1 - jaro)
        break
      }
      default:
        return {
          score: 0,
          algorithm,
          error:
            'Unknown algorithm: ' +
            algorithm +
            '. Supported: levenshtein, jaccard, cosine, dice, hamming, jaro-winkler',
        }
    }

    return { score: Math.round(score * 10000) / 10000, algorithm }
  } catch (err: unknown) {
    return { score: 0, algorithm, error: (err as Error).message }
  }
}
export const utilitySimilarityScoring: NodeHandlerGenerator = {
  nodeType: 'utility-similarity-scoring',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_similarity_scoring)
  },
}
