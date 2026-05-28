import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_extract_links(config: any, context: Record<string, unknown>) {
  let text = config.text || ''
  const url = config.url || ''
  let baseUrl = config.baseUrl || ''
  const deduplicate = config.deduplicate !== undefined ? config.deduplicate : true
  const categorize = config.categorize !== undefined ? config.categorize : true

  try {
    if (url) {
      const response = await fetch(url)
      if (!response.ok) {
        return { links: [], error: 'Failed to fetch URL: HTTP ' + response.status }
      }
      text = await response.text()
      if (!baseUrl) {
        const parsedUrl = new URL(url)
        baseUrl = parsedUrl.protocol + '//' + parsedUrl.host
      }
    }

    if (!text) {
      return { links: [], totalCount: 0 }
    }

    const links: Array<{ type: string; value: string; text?: string; category?: string }> = []
    const seen: Record<string, boolean> = {}

    function resolveUrl(href: string): string {
      if (
        !href ||
        href.indexOf('javascript:') === 0 ||
        href.indexOf('mailto:') === 0 ||
        href.indexOf('tel:') === 0 ||
        href.charAt(0) === '#'
      ) {
        return href
      }
      if (
        href.indexOf('http://') === 0 ||
        href.indexOf('https://') === 0 ||
        href.indexOf('//') === 0
      ) {
        return href
      }
      if (baseUrl) {
        if (href.charAt(0) === '/') {
          return baseUrl + href
        }
        return baseUrl + '/' + href
      }
      return href
    }

    function categorizeLink(href: string): string {
      if (!categorize) {
        return 'link'
      }
      const lower = href.toLowerCase()
      if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|$)/i.test(lower)) {
        return 'image'
      }
      if (/\.(mp4|webm|avi|mov|wmv|flv)(\?|$)/i.test(lower)) {
        return 'video'
      }
      if (/\.(mp3|wav|ogg|flac|aac)(\?|$)/i.test(lower)) {
        return 'audio'
      }
      if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)(\?|$)/i.test(lower)) {
        return 'document'
      }
      if (/\.(zip|rar|tar|gz|7z)(\?|$)/i.test(lower)) {
        return 'archive'
      }
      if (/\.(js|css|woff|woff2|ttf|eot)(\?|$)/i.test(lower)) {
        return 'asset'
      }
      if (lower.indexOf('mailto:') === 0) {
        return 'email'
      }
      if (lower.indexOf('tel:') === 0) {
        return 'phone'
      }
      return 'page'
    }

    function addLink(type: string, value: string, linkText?: string) {
      const resolved = resolveUrl(value)
      const key = resolved.toLowerCase()
      if (deduplicate && seen[key]) {
        return
      }
      seen[key] = true
      const entry: any = { type, value: resolved }
      if (linkText) {
        entry.text = linkText.trim()
      }
      if (categorize) {
        entry.category = categorizeLink(resolved)
      }
      links.push(entry)
    }

    const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi
    let hrefMatch = hrefRegex.exec(text)
    while (hrefMatch !== null) {
      addLink('href', hrefMatch[1], hrefMatch[2])
      hrefMatch = hrefRegex.exec(text)
    }

    const hrefOnlyRegex = /href=["']([^"']+)["']/g
    let hrefOnlyMatch = hrefOnlyRegex.exec(text)
    while (hrefOnlyMatch !== null) {
      addLink('href', hrefOnlyMatch[1])
      hrefOnlyMatch = hrefOnlyRegex.exec(text)
    }

    const srcRegex = /src=["']([^"']+)["']/g
    let srcMatch = srcRegex.exec(text)
    while (srcMatch !== null) {
      addLink('src', srcMatch[1])
      srcMatch = srcRegex.exec(text)
    }

    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g
    const urlMatches = text.match(urlRegex) || []
    for (let i = 0; i < urlMatches.length; i++) {
      let cleanUrl = urlMatches[i]
      if (
        cleanUrl.charAt(cleanUrl.length - 1) === '.' ||
        cleanUrl.charAt(cleanUrl.length - 1) === ','
      ) {
        cleanUrl = cleanUrl.substring(0, cleanUrl.length - 1)
      }
      addLink('url', cleanUrl)
    }

    return { links, totalCount: links.length }
  } catch (err: unknown) {
    return { links: [], totalCount: 0, error: (err as Error).message }
  }
}

export const utilityExtractLinks: NodeHandlerGenerator = {
  nodeType: 'utility-extract-links',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_extract_links)
  },
}
