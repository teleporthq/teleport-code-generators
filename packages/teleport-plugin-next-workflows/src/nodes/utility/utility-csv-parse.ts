import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_csv_parse(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'parse'
  let data = config.data || ''
  let delimiter = config.delimiter || ','
  const hasHeaders = config.hasHeaders !== undefined ? config.hasHeaders : true
  const trimFields = config.trimFields !== undefined ? config.trimFields : true
  const skipEmpty = config.skipEmpty !== undefined ? config.skipEmpty : true

  if (operation === 'generate') {
    const genRows = config.rows || []
    const columns = config.columns || null
    const includeHeaders = config.includeHeaders !== undefined ? config.includeHeaders : true
    const quoteAll = config.quoteAll !== undefined ? config.quoteAll : false
    const lineEnding = config.lineEnding || '\n'

    try {
      if (!genRows || genRows.length === 0) {
        return { csv: '', rowCount: 0, headers: [] }
      }

      let headers: string[] = []
      const isObjects = typeof genRows[0] === 'object' && !Array.isArray(genRows[0])

      if (isObjects) {
        if (columns && columns.length > 0) {
          headers = columns
        } else {
          const keySet: Record<string, boolean> = {}
          for (let ki = 0; ki < genRows.length; ki++) {
            const objKeys = Object.keys(genRows[ki])
            for (let kj = 0; kj < objKeys.length; kj++) {
              keySet[objKeys[kj]] = true
            }
          }
          headers = Object.keys(keySet)
        }
      } else if (columns && columns.length > 0) {
        headers = columns
      }

      function escapeField(value: any): string {
        const str = value === null || value === undefined ? '' : String(value)
        let needsQuote = quoteAll
        if (!needsQuote) {
          for (let ei = 0; ei < str.length; ei++) {
            const ec = str.charAt(ei)
            if (ec === delimiter || ec === '"' || ec === '\n' || ec === '\r') {
              needsQuote = true
              break
            }
          }
        }
        if (needsQuote) {
          let escaped = ''
          for (let ej = 0; ej < str.length; ej++) {
            const esc = str.charAt(ej)
            if (esc === '"') {
              escaped += '""'
            } else {
              escaped += esc
            }
          }
          return '"' + escaped + '"'
        }
        return str
      }

      const csvLines: string[] = []

      if (includeHeaders && headers.length > 0) {
        let headerLine = ''
        for (let hi = 0; hi < headers.length; hi++) {
          if (hi > 0) {
            headerLine += delimiter
          }
          headerLine += escapeField(headers[hi])
        }
        csvLines.push(headerLine)
      }

      for (let ri = 0; ri < genRows.length; ri++) {
        const row = genRows[ri]
        let line = ''
        if (isObjects) {
          for (let fi = 0; fi < headers.length; fi++) {
            if (fi > 0) {
              line += delimiter
            }
            line += escapeField(row[headers[fi]])
          }
        } else if (Array.isArray(row)) {
          for (let ai = 0; ai < row.length; ai++) {
            if (ai > 0) {
              line += delimiter
            }
            line += escapeField(row[ai])
          }
        } else {
          line += escapeField(row)
        }
        csvLines.push(line)
      }

      let csv = ''
      for (let li = 0; li < csvLines.length; li++) {
        if (li > 0) {
          csv += lineEnding
        }
        csv += csvLines[li]
      }

      return { csv, rowCount: genRows.length, headers }
    } catch (err: unknown) {
      return { csv: '', rowCount: 0, headers: [], error: (err as Error).message }
    }
  }

  if (operation === 'auto-detect') {
    const detectDelimiters = [',', ';', '\t', '|']
    const sampleLines: string[] = []
    let sampleCurrent = ''
    let sampleCount = 0

    for (let si = 0; si < data.length && sampleCount < 5; si++) {
      const sch = data.charAt(si)
      if (sch === '\n' || sch === '\r') {
        sampleLines.push(sampleCurrent)
        sampleCurrent = ''
        sampleCount++
        if (sch === '\r' && si + 1 < data.length && data.charAt(si + 1) === '\n') {
          si++
        }
      } else {
        sampleCurrent += sch
      }
    }
    if (sampleCurrent.length > 0 && sampleCount < 5) {
      sampleLines.push(sampleCurrent)
    }

    let bestDelimiter = ','
    let bestScore = -1

    for (let di = 0; di < detectDelimiters.length; di++) {
      const testDelim = detectDelimiters[di]
      const counts: number[] = []
      for (let dli = 0; dli < sampleLines.length; dli++) {
        let cnt = 0
        for (let dci = 0; dci < sampleLines[dli].length; dci++) {
          if (sampleLines[dli].charAt(dci) === testDelim) {
            cnt++
          }
        }
        counts.push(cnt)
      }

      if (counts.length === 0) {
        continue
      }

      let allZero = true
      for (let zi = 0; zi < counts.length; zi++) {
        if (counts[zi] > 0) {
          allZero = false
          break
        }
      }
      if (allZero) {
        continue
      }

      let sum = 0
      for (let smi = 0; smi < counts.length; smi++) {
        sum += counts[smi]
      }
      const avg = sum / counts.length

      let variance = 0
      for (let vi = 0; vi < counts.length; vi++) {
        const diff = counts[vi] - avg
        variance += diff * diff
      }
      variance = variance / counts.length

      const consistency = avg / (1 + variance)

      if (consistency > bestScore) {
        bestScore = consistency
        bestDelimiter = testDelim
      }
    }

    delimiter = bestDelimiter
  }

  if (operation === 'parse' || operation === 'auto-detect') {
    if (!data) {
      return { rows: [], headers: [], rowCount: 0 }
    }

    try {
      if (data.charCodeAt(0) === 0xfeff) {
        data = data.substring(1)
      }

      const lines: string[] = []
      let current = ''
      let inQuotes = false

      for (let ci = 0; ci < data.length; ci++) {
        const ch = data.charAt(ci)
        if (ch === '"') {
          current += ch
          if (inQuotes && ci + 1 < data.length && data.charAt(ci + 1) === '"') {
            current += '"'
            ci++
          } else {
            inQuotes = !inQuotes
          }
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
          lines.push(current)
          current = ''
          if (ch === '\r' && ci + 1 < data.length && data.charAt(ci + 1) === '\n') {
            ci++
          }
        } else {
          current += ch
        }
      }
      if (current.length > 0 || lines.length > 0) {
        lines.push(current)
      }

      function parseLine(line: string): string[] {
        const fields: string[] = []
        let field = ''
        let inQ = false
        for (let pi = 0; pi < line.length; pi++) {
          const pc = line.charAt(pi)
          if (pc === '"') {
            if (inQ && pi + 1 < line.length && line.charAt(pi + 1) === '"') {
              field += '"'
              pi++
            } else {
              inQ = !inQ
            }
          } else if (pc === delimiter && !inQ) {
            fields.push(trimFields ? field.trim() : field)
            field = ''
          } else {
            field += pc
          }
        }
        fields.push(trimFields ? field.trim() : field)
        return fields
      }

      function isEmptyLine(line: string): boolean {
        for (let i = 0; i < line.length; i++) {
          const c = line.charAt(i)
          if (c !== ' ' && c !== '\t' && c !== '\r') {
            return false
          }
        }
        return true
      }

      let headers: string[] = []
      const rows: any[] = []

      if (hasHeaders && lines.length > 0) {
        headers = parseLine(lines[0])
        for (let hi = 1; hi < lines.length; hi++) {
          if (skipEmpty && isEmptyLine(lines[hi])) {
            continue
          }
          const values = parseLine(lines[hi])
          const parseRow: Record<string, string> = {}
          for (let hj = 0; hj < headers.length; hj++) {
            parseRow[headers[hj]] = hj < values.length ? values[hj] : ''
          }
          for (let extra = headers.length; extra < values.length; extra++) {
            parseRow['_col' + extra] = values[extra]
          }
          rows.push(parseRow)
        }
      } else {
        for (let ri = 0; ri < lines.length; ri++) {
          if (skipEmpty && isEmptyLine(lines[ri])) {
            continue
          }
          rows.push(parseLine(lines[ri]))
        }
      }

      const result: any = { rows, headers, rowCount: rows.length }
      if (operation === 'auto-detect') {
        result.detectedDelimiter = delimiter
      }
      return result
    } catch (err: unknown) {
      return { rows: [], headers: [], rowCount: 0, error: (err as Error).message }
    }
  }

  return { rows: [], headers: [], rowCount: 0, error: 'Unknown operation: ' + operation }
}

export const utilityCsvParse: NodeHandlerGenerator = {
  nodeType: 'utility-csv-parse',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_csv_parse)
  },
}
