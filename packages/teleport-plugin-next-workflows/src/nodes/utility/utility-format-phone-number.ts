import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_format_phone_number(config: any, context: Record<string, unknown>) {
  const phone = config.phone || ''
  const format = config.format || 'international'
  const countryCode = config.countryCode || ''

  if (!phone) {
    return { formatted: null, error: 'No phone number provided' }
  }

  try {
    const cleaned = phone.replace(/[^0-9+]/g, '')
    let hasPlus = cleaned.charAt(0) === '+'
    let digits = cleaned.replace(/[^0-9]/g, '')

    if (digits.length < 7 || digits.length > 15) {
      return {
        formatted: null,
        error: 'Phone number has invalid length (' + digits.length + ' digits)',
      }
    }

    if (countryCode && !hasPlus) {
      const cc = countryCode.replace(/[^0-9]/g, '')
      if (cc && digits.indexOf(cc) !== 0) {
        digits = cc + digits
      }
      hasPlus = true
    }

    let formatted: string

    switch (format) {
      case 'international':
        if (hasPlus || digits.length > 10) {
          formatted = '+' + digits
        } else {
          formatted = digits
        }
        break
      case 'national':
        if (digits.length === 11 && digits.charAt(0) === '1') {
          const nd = digits.substring(1)
          formatted = '(' + nd.substring(0, 3) + ') ' + nd.substring(3, 6) + '-' + nd.substring(6)
        } else if (digits.length === 10) {
          formatted =
            '(' + digits.substring(0, 3) + ') ' + digits.substring(3, 6) + '-' + digits.substring(6)
        } else if (digits.length >= 7 && digits.length <= 8) {
          formatted =
            digits.substring(0, digits.length - 4) + '-' + digits.substring(digits.length - 4)
        } else {
          formatted = digits
        }
        break
      case 'e164':
        formatted = '+' + digits
        break
      case 'rfc3966':
        formatted = 'tel:+' + digits
        break
      case 'dashes':
        if (digits.length === 11 && digits.charAt(0) === '1') {
          formatted =
            '+1-' +
            digits.substring(1, 4) +
            '-' +
            digits.substring(4, 7) +
            '-' +
            digits.substring(7)
        } else if (digits.length === 10) {
          formatted =
            digits.substring(0, 3) + '-' + digits.substring(3, 6) + '-' + digits.substring(6)
        } else {
          formatted = digits
        }
        break
      case 'dots':
        if (digits.length === 11 && digits.charAt(0) === '1') {
          formatted =
            '+1.' +
            digits.substring(1, 4) +
            '.' +
            digits.substring(4, 7) +
            '.' +
            digits.substring(7)
        } else if (digits.length === 10) {
          formatted =
            digits.substring(0, 3) + '.' + digits.substring(3, 6) + '.' + digits.substring(6)
        } else {
          formatted = digits
        }
        break
      case 'spaces':
        if (hasPlus || digits.length > 10) {
          let spCC = ''
          let rest = digits
          if (digits.length === 11 && digits.charAt(0) === '1') {
            spCC = '+1 '
            rest = digits.substring(1)
          } else if (digits.length > 10) {
            let ccLen = digits.length - 10
            if (ccLen > 3) {
              ccLen = 3
            }
            spCC = '+' + digits.substring(0, ccLen) + ' '
            rest = digits.substring(ccLen)
          }
          formatted =
            spCC + rest.substring(0, 3) + ' ' + rest.substring(3, 6) + ' ' + rest.substring(6)
        } else if (digits.length === 10) {
          formatted =
            digits.substring(0, 3) + ' ' + digits.substring(3, 6) + ' ' + digits.substring(6)
        } else {
          formatted = digits
        }
        break
      default:
        formatted = digits
    }

    return { formatted, digits, digitCount: digits.length }
  } catch (err: unknown) {
    return { formatted: null, error: (err as Error).message }
  }
}
export const utilityFormatPhoneNumber: NodeHandlerGenerator = {
  nodeType: 'utility-format-phone-number',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_format_phone_number)
  },
}
