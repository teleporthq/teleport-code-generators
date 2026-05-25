import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_verify_phone(config: any, context: Record<string, unknown>) {
  let phone = config.phone || ''

  if (!phone || typeof phone !== 'string') {
    return { isValid: false, details: {}, error: 'No phone number provided' }
  }

  try {
    phone = phone.trim()
    const cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
    const hasPlus = cleaned.charAt(0) === '+'
    const digitsOnly = cleaned.replace(/[^0-9]/g, '')
    const isValidLength = digitsOnly.length >= 7 && digitsOnly.length <= 15
    const isValidChars = /^[+]?[0-9\s\-\(\)\.]+$/.test(phone)

    let countryCode = ''
    let nationalNumber = digitsOnly

    if (hasPlus && digitsOnly.length > 0) {
      if (digitsOnly.charAt(0) === '1' && digitsOnly.length === 11) {
        countryCode = '1'
        nationalNumber = digitsOnly.substring(1)
      } else if (digitsOnly.length >= 10) {
        const ccLen = digitsOnly.length <= 11 ? 1 : digitsOnly.length <= 12 ? 2 : 3
        countryCode = digitsOnly.substring(0, ccLen)
        nationalNumber = digitsOnly.substring(ccLen)
      }
    } else if (!hasPlus && digitsOnly.length === 11 && digitsOnly.charAt(0) === '1') {
      countryCode = '1'
      nationalNumber = digitsOnly.substring(1)
    }

    let possibleType = 'unknown'
    if (nationalNumber.length === 10 && (countryCode === '1' || countryCode === '')) {
      const areaCode = nationalNumber.substring(0, 3)
      if (areaCode.charAt(0) !== '0' && areaCode.charAt(0) !== '1') {
        possibleType = 'fixed_or_mobile'
      }
    }

    let e164 = ''
    if (isValidLength && isValidChars) {
      e164 = '+' + digitsOnly
    }

    return {
      isValid: isValidLength && isValidChars,
      details: {
        original: phone,
        cleaned,
        digitsOnly,
        hasCountryCode: hasPlus,
        countryCode,
        nationalNumber,
        digitCount: digitsOnly.length,
        validLength: isValidLength,
        validCharacters: isValidChars,
        e164,
        possibleType,
      },
    }
  } catch (err: unknown) {
    return { isValid: false, details: {}, error: (err as Error).message }
  }
}
export const utilityVerifyPhone: NodeHandlerGenerator = {
  nodeType: 'utility-verify-phone',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_verify_phone)
  },
}
