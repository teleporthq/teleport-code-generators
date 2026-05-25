import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_verify_email(config: any, context: Record<string, unknown>) {
  let email = config.email || ''
  const checkDisposable = config.checkDisposable !== undefined ? config.checkDisposable : true

  try {
    if (!email || typeof email !== 'string') {
      return { isValid: false, details: { format: false }, error: 'No email provided' }
    }

    email = email.trim().toLowerCase()

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const isFormatValid = emailRegex.test(email)

    const parts = email.split('@')
    const localPart = parts.length === 2 ? parts[0] : ''
    const domain = parts.length === 2 ? parts[1] : ''

    const hasValidLength = email.length > 0 && email.length <= 254
    const localPartValid = localPart.length > 0 && localPart.length <= 64
    const domainValid = domain.length > 0 && domain.length <= 253

    const hasConsecutiveDots = localPart.indexOf('..') !== -1 || domain.indexOf('..') !== -1
    const startsOrEndsWithDot =
      localPart.charAt(0) === '.' || localPart.charAt(localPart.length - 1) === '.'
    const domainHasDot = domain.indexOf('.') !== -1
    const tld = domain.indexOf('.') !== -1 ? domain.substring(domain.lastIndexOf('.') + 1) : ''
    const tldValid = tld.length >= 2

    const domainParts = domain.split('.')
    let domainLabelsValid = true
    for (let dp = 0; dp < domainParts.length; dp++) {
      if (domainParts[dp].length === 0 || domainParts[dp].length > 63) {
        domainLabelsValid = false
        break
      }
      if (/[^a-z0-9-]/.test(domainParts[dp])) {
        domainLabelsValid = false
        break
      }
      if (
        domainParts[dp].charAt(0) === '-' ||
        domainParts[dp].charAt(domainParts[dp].length - 1) === '-'
      ) {
        domainLabelsValid = false
        break
      }
    }

    let isDisposable = false
    if (checkDisposable && domain) {
      const disposableDomains: Record<string, boolean> = {
        'tempmail.com': true,
        'throwaway.email': true,
        'guerrillamail.com': true,
        'guerrillamail.net': true,
        'guerrillamail.org': true,
        'mailinator.com': true,
        'yopmail.com': true,
        'yopmail.fr': true,
        'tempail.com': true,
        'trashmail.com': true,
        'sharklasers.com': true,
        'guerrillamailblock.com': true,
        'grr.la': true,
        'dispostable.com': true,
        'maildrop.cc': true,
        'mailnesia.com': true,
        'tempr.email': true,
        'discard.email': true,
        'tmpmail.net': true,
        'tmpmail.org': true,
        'binkmail.com': true,
        'safetymail.info': true,
        'spam4.me': true,
        'trashmail.me': true,
        'fakeinbox.com': true,
        'getnada.com': true,
        'temp-mail.org': true,
        'harakirimail.com': true,
        'emkei.cz': true,
        'jetable.org': true,
        'mytemp.email': true,
        'getairmail.com': true,
        'mohmal.com': true,
        '10minutemail.com': true,
        'minutemail.com': true,
        'emailondeck.com': true,
        'mailcatch.com': true,
        'incognitomail.org': true,
        'burnermail.io': true,
      }
      isDisposable = disposableDomains[domain] === true
    }

    const structurallyValid =
      isFormatValid &&
      hasValidLength &&
      localPartValid &&
      domainValid &&
      !hasConsecutiveDots &&
      !startsOrEndsWithDot &&
      domainHasDot &&
      tldValid &&
      domainLabelsValid

    return {
      isValid: structurallyValid && !isDisposable,
      details: {
        format: isFormatValid,
        localPart,
        domain,
        tld,
        hasValidLength,
        localPartValid,
        domainValid: domainValid && domainLabelsValid,
        hasConsecutiveDots,
        startsOrEndsWithDot,
        tldValid,
        isDisposable,
        structurallyValid,
      },
    }
  } catch (err: unknown) {
    return { isValid: false, details: {}, error: (err as Error).message }
  }
}
export const utilityVerifyEmail: NodeHandlerGenerator = {
  nodeType: 'utility-verify-email',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_verify_email)
  },
}
