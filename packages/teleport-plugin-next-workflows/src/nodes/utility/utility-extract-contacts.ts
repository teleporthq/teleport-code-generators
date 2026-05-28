import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_extract_contacts(config: any, context: Record<string, unknown>) {
  const text = config.text || ''
  const deduplicate = config.deduplicate !== undefined ? config.deduplicate : true
  const extractEmails = config.extractEmails !== undefined ? config.extractEmails : true
  const extractPhones = config.extractPhones !== undefined ? config.extractPhones : true
  const extractUrls = config.extractUrls !== undefined ? config.extractUrls : true
  const extractSocial = config.extractSocial !== undefined ? config.extractSocial : true

  if (!text) {
    return { contacts: [], emails: [], phones: [], urls: [], social: [] }
  }

  try {
    const contacts: Array<{ type: string; value: string }> = []
    const seen: Record<string, boolean> = {}

    function addContact(type: string, value: string) {
      const key = type + ':' + value.toLowerCase()
      if (deduplicate && seen[key]) {
        return
      }
      seen[key] = true
      contacts.push({ type, value })
    }

    const emails: string[] = []
    if (extractEmails) {
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
      const emailMatches = text.match(emailRegex) || []
      for (let e = 0; e < emailMatches.length; e++) {
        const email = emailMatches[e].toLowerCase()
        if (
          email.indexOf('..') === -1 &&
          email.charAt(0) !== '.' &&
          email.charAt(email.length - 1) !== '.'
        ) {
          addContact('email', email)
          if (emails.indexOf(email) === -1) {
            emails.push(email)
          }
        }
      }
    }

    const phones: string[] = []
    if (extractPhones) {
      const phoneRegex =
        /(?:\+?[0-9]{1,3}[\s\-]?)?(?:\([0-9]{1,4}\)[\s\-]?)?[0-9][0-9\s\-\.]{6,14}[0-9]/g
      const phoneMatches = text.match(phoneRegex) || []
      for (let p = 0; p < phoneMatches.length; p++) {
        const cleaned = phoneMatches[p].replace(/[\s\-\.\(\)]/g, '')
        if (cleaned.length >= 7 && cleaned.length <= 15) {
          const phoneVal = phoneMatches[p].trim()
          addContact('phone', phoneVal)
          if (phones.indexOf(phoneVal) === -1) {
            phones.push(phoneVal)
          }
        }
      }
    }

    const urls: string[] = []
    if (extractUrls) {
      const urlRegex = /https?:\/\/[^\s<>"')\]]+/g
      const urlMatches = text.match(urlRegex) || []
      for (let u = 0; u < urlMatches.length; u++) {
        let url = urlMatches[u]
        if (url.charAt(url.length - 1) === '.' || url.charAt(url.length - 1) === ',') {
          url = url.substring(0, url.length - 1)
        }
        addContact('url', url)
        if (urls.indexOf(url) === -1) {
          urls.push(url)
        }
      }
    }

    const social: Array<{ platform: string; handle: string }> = []
    if (extractSocial) {
      const twitterRegex = /(?:^|[\s(])@([a-zA-Z0-9_]{1,15})(?=[\s.,!?;:)\]]|$)/g
      let twitterMatch = twitterRegex.exec(text)
      while (twitterMatch !== null) {
        const handle = twitterMatch[1]
        const commonWords: Record<string, boolean> = {
          the: true,
          and: true,
          for: true,
          are: true,
          but: true,
          not: true,
        }
        if (!commonWords[handle.toLowerCase()]) {
          addContact('social', '@' + handle)
          social.push({ platform: 'twitter/x', handle: '@' + handle })
        }
        twitterMatch = twitterRegex.exec(text)
      }

      const linkedinRegex = /linkedin\.com\/in\/([a-zA-Z0-9\-]+)/g
      let liMatch = linkedinRegex.exec(text)
      while (liMatch !== null) {
        social.push({ platform: 'linkedin', handle: liMatch[1] })
        liMatch = linkedinRegex.exec(text)
      }

      const githubRegex = /github\.com\/([a-zA-Z0-9\-]+)/g
      let ghMatch = githubRegex.exec(text)
      while (ghMatch !== null) {
        if (ghMatch[1] !== 'orgs' && ghMatch[1] !== 'settings' && ghMatch[1] !== 'features') {
          social.push({ platform: 'github', handle: ghMatch[1] })
        }
        ghMatch = githubRegex.exec(text)
      }
    }

    return {
      contacts,
      emails,
      phones,
      urls,
      social,
      totalCount: contacts.length,
    }
  } catch (err: unknown) {
    return {
      contacts: [],
      emails: [],
      phones: [],
      urls: [],
      social: [],
      error: (err as Error).message,
    }
  }
}

export const utilityExtractContacts: NodeHandlerGenerator = {
  nodeType: 'utility-extract-contacts',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_extract_contacts)
  },
}
