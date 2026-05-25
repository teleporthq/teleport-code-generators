import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_xml_parse(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'parse'
  const ignoreAttributes = config.ignoreAttributes !== undefined ? config.ignoreAttributes : false
  const attributeNamePrefix =
    config.attributeNamePrefix !== undefined ? config.attributeNamePrefix : '@_'
  const textNodeName = config.textNodeName || '#text'
  const arrayMode = config.arrayMode !== undefined ? config.arrayMode : false
  const trimValues = config.trimValues !== undefined ? config.trimValues : true
  const parseTrueNumberOnly =
    config.parseTrueNumberOnly !== undefined ? config.parseTrueNumberOnly : false
  const cdataTagName = config.cdataTagName || '__cdata'

  const fxp = require('fast-xml-parser')

  if (operation === 'generate') {
    const input = config.input
    const rootName = config.rootName || 'root'
    const declaration = config.declaration !== undefined ? config.declaration : true
    const indentation = config.indentation !== undefined ? config.indentation : '  '
    const format = config.format !== undefined ? config.format : true

    if (!input || typeof input !== 'object') {
      return { result: null, error: 'No valid input object provided for XML generation' }
    }

    try {
      const builder = new fxp.XMLBuilder({
        ignoreAttributes,
        attributeNamePrefix,
        textNodeName,
        format,
        indentBy: indentation,
        suppressEmptyNode: true,
      })

      const wrappedInput: Record<string, unknown> = {}
      wrappedInput[rootName] = input
      let xml = builder.build(wrappedInput)

      if (declaration) {
        xml = '<?xml version="1.0" encoding="UTF-8"?>' + (format ? '\n' : '') + xml
      }

      return { result: xml }
    } catch (err: unknown) {
      return { result: null, error: (err as Error).message }
    }
  }

  if (operation === 'validate') {
    const validationXml = config.data || ''

    if (!validationXml) {
      return { result: { valid: false, errors: ['No XML data provided'] } }
    }

    const errors: string[] = []

    try {
      const XMLValidator = fxp.XMLValidator
      const validationResult = XMLValidator.validate(validationXml)

      if (validationResult !== true) {
        const errMsg = validationResult.err
          ? 'Line ' +
            validationResult.err.line +
            ', Column ' +
            validationResult.err.col +
            ': ' +
            validationResult.err.msg
          : 'Invalid XML'
        errors.push(errMsg)
      }
    } catch (err: unknown) {
      errors.push((err as Error).message)
    }

    if (errors.length === 0) {
      const tagStack: string[] = []
      const selfClosingRegex = /<([a-zA-Z][a-zA-Z0-9_:-]*)[^>]*\/>/g
      const openTagRegex = /<([a-zA-Z][a-zA-Z0-9_:-]*)[^>]*(?<!\/)>/g
      const closeTagRegex = /<\/([a-zA-Z][a-zA-Z0-9_:-]*)>/g

      const strippedData = validationXml
        .replace(/<\?[^?]*\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')

      const selfClosingTags: Record<string, boolean> = {}
      let selfMatch = selfClosingRegex.exec(strippedData)
      while (selfMatch !== null) {
        selfClosingTags[selfMatch.index + ':' + selfMatch[1]] = true
        selfMatch = selfClosingRegex.exec(strippedData)
      }

      let openMatch = openTagRegex.exec(strippedData)
      while (openMatch !== null) {
        const tagText = openMatch[0]
        if (tagText.indexOf('</') === 0) {
          openMatch = openTagRegex.exec(strippedData)
          continue
        }
        if (selfClosingTags[openMatch.index + ':' + openMatch[1]]) {
          openMatch = openTagRegex.exec(strippedData)
          continue
        }
        tagStack.push(openMatch[1])
        openMatch = openTagRegex.exec(strippedData)
      }

      let closeMatch = closeTagRegex.exec(strippedData)
      while (closeMatch !== null) {
        const closeName = closeMatch[1]
        let foundIndex = -1
        for (let si = tagStack.length - 1; si >= 0; si--) {
          if (tagStack[si] === closeName) {
            foundIndex = si
            break
          }
        }
        if (foundIndex === -1) {
          errors.push('Mismatched closing tag: </' + closeName + '>')
        } else {
          for (let ri = tagStack.length - 1; ri > foundIndex; ri--) {
            errors.push('Unclosed tag: <' + tagStack[ri] + '>')
          }
          tagStack.splice(foundIndex, tagStack.length - foundIndex)
        }
        closeMatch = closeTagRegex.exec(strippedData)
      }

      for (let ti = tagStack.length - 1; ti >= 0; ti--) {
        errors.push('Unclosed tag: <' + tagStack[ti] + '>')
      }
    }

    return { result: { valid: errors.length === 0, errors } }
  }

  // Default: parse operation
  const data = config.data || ''

  if (!data) {
    return { result: null, error: 'No XML data provided' }
  }

  try {
    const XMLParser = fxp.XMLParser

    const parser = new XMLParser({
      ignoreAttributes,
      attributeNamePrefix,
      textNodeName,
      isArray: arrayMode
        ? function () {
            return true
          }
        : undefined,
      trimValues,
      parseTrueNumberOnly,
      cdataPropName: cdataTagName,
      processEntities: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
    })

    const result = parser.parse(data)

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}

export const utilityXmlParse: NodeHandlerGenerator = {
  nodeType: 'utility-xml-parse',
  executionEnv: 'server',
  dependencies: {
    'fast-xml-parser': '^4.3.0',
  },
  generateHandler(): string {
    return handlerToString(utility_xml_parse)
  },
}
