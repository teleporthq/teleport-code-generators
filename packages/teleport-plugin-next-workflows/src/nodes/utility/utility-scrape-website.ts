import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_scrape_website(config: any, context: Record<string, unknown>) {
  const url = config.url
  const selector = config.selector || 'body'
  const outputType = config.outputType || 'text'
  const multiple = config.multiple || false
  const attributes = config.attributes || []
  const timeout = config.timeout !== undefined ? Number(config.timeout) : 30000
  const userAgent = config.userAgent || 'Mozilla/5.0 (compatible; Bot/1.0)'
  const headers = config.headers || {}
  const crawl = config.crawl || false
  const maxDepth = config.maxDepth !== undefined ? Math.min(Number(config.maxDepth), 5) : 1
  const maxPages = config.maxPages !== undefined ? Math.min(Number(config.maxPages), 50) : 10
  const sameDomainOnly = config.sameDomainOnly !== false
  const respectRobotsTxt = config.respectRobotsTxt !== false
  const excludePatterns = config.excludePatterns || []
  const includePatterns = config.includePatterns || []
  const extractMetadata = config.extractMetadata || false

  if (!url) {
    return { content: null, statusCode: 0, error: 'No URL provided' }
  }

  const __nodeRequire =
    typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
  const cheerio = __nodeRequire('cheerio')

  function getDomain(u: string) {
    try {
      const parsed = new URL(u)
      return parsed.hostname
    } catch (e) {
      return ''
    }
  }

  function normalizeUrl(u: string, base: string) {
    try {
      const resolved = new URL(u, base)
      resolved.hash = ''
      let normalized = resolved.href
      if (normalized.endsWith('/') && normalized.split('/').length > 4) {
        normalized = normalized.slice(0, -1)
      }
      return normalized
    } catch (e) {
      return ''
    }
  }

  function matchesPattern(u: string, patterns: string[]) {
    for (let pi = 0; pi < patterns.length; pi++) {
      const pattern = patterns[pi]
      if (pattern.charAt(0) === '/' && pattern.charAt(pattern.length - 1) === '/') {
        try {
          if (new RegExp(pattern.slice(1, -1)).test(u)) {
            return true
          }
        } catch (e) {
          /* skip invalid regex */
        }
      } else {
        if (u.indexOf(pattern) !== -1) {
          return true
        }
      }
    }
    return false
  }

  async function fetchPage(pageUrl: string) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const fetchOpts: Record<string, any> = {
      headers: { 'User-Agent': userAgent, ...headers },
      redirect: 'follow',
    }

    if (controller) {
      fetchOpts.signal = controller.signal
      timeoutId = setTimeout(function () {
        controller!.abort()
      }, timeout)
    }

    try {
      const response = await fetch(pageUrl, fetchOpts)
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        return { html: null, status: response.status, error: 'HTTP ' + response.status }
      }

      const contentType = response.headers.get('content-type') || ''
      if (
        contentType.indexOf('text/html') === -1 &&
        contentType.indexOf('application/xhtml') === -1
      ) {
        return { html: null, status: response.status, error: 'Not HTML: ' + contentType }
      }

      const html = await response.text()
      return { html, status: response.status, error: null }
    } catch (err: unknown) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      if ((err as Error).name === 'AbortError') {
        return { html: null, status: 0, error: 'Timeout' }
      }
      return { html: null, status: 0, error: (err as Error).message }
    }
  }

  function extractContent($: any, pageUrl: string) {
    const result: Record<string, any> = { url: pageUrl }

    if (extractMetadata) {
      result.title = $('title').first().text().trim() || null
      result.description =
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        null
      result.ogImage = $('meta[property="og:image"]').attr('content') || null
      result.canonical = $('link[rel="canonical"]').attr('href') || null
      result.lang = $('html').attr('lang') || null
      result.h1 = $('h1').first().text().trim() || null
    }

    if (multiple) {
      const items: any[] = []
      $(selector).each(function (_: any, el: any) {
        if (attributes.length > 0) {
          const attrs: Record<string, any> = {}
          for (let a = 0; a < attributes.length; a++) {
            attrs[attributes[a]] = $(el).attr(attributes[a]) || null
          }
          attrs._text = $(el).text().trim()
          attrs._html = $(el).html()
          items.push(attrs)
        } else if (outputType === 'html') {
          items.push($(el).html())
        } else {
          items.push($(el).text().trim())
        }
      })
      result.content = items
      result.count = items.length
    } else {
      if (attributes.length > 0) {
        const attrResult: Record<string, any> = {}
        for (let ai = 0; ai < attributes.length; ai++) {
          attrResult[attributes[ai]] = $(selector).first().attr(attributes[ai]) || null
        }
        attrResult._text = $(selector).first().text().trim()
        attrResult._html = $(selector).first().html()
        result.content = attrResult
      } else if (outputType === 'html') {
        result.content = $(selector).html()
      } else {
        result.content = $(selector).text().trim()
      }
    }

    return result
  }

  function extractLinks($: any, pageUrl: string, baseDomain: string) {
    const links: string[] = []
    const seen = new Set()
    $('a[href]').each(function (_: any, el: any) {
      const href = $(el).attr('href')
      if (!href) {
        return
      }
      if (
        href.indexOf('#') === 0 ||
        href.indexOf('javascript:') === 0 ||
        href.indexOf('mailto:') === 0 ||
        href.indexOf('tel:') === 0 ||
        href.indexOf('data:') === 0
      ) {
        return
      }

      const normalized = normalizeUrl(href, pageUrl)
      if (!normalized) {
        return
      }
      if (seen.has(normalized)) {
        return
      }
      seen.add(normalized)

      if (sameDomainOnly && getDomain(normalized) !== baseDomain) {
        return
      }

      if (excludePatterns.length > 0 && matchesPattern(normalized, excludePatterns)) {
        return
      }
      if (includePatterns.length > 0 && !matchesPattern(normalized, includePatterns)) {
        return
      }

      const ext = normalized.split('?')[0].split('#')[0]
      const lastDot = ext.lastIndexOf('.')
      if (lastDot !== -1) {
        const extension = ext.substring(lastDot + 1).toLowerCase()
        const skipExts = [
          'pdf',
          'jpg',
          'jpeg',
          'png',
          'gif',
          'svg',
          'webp',
          'mp4',
          'mp3',
          'zip',
          'rar',
          'exe',
          'dmg',
          'css',
          'js',
          'xml',
          'json',
        ]
        if (skipExts.indexOf(extension) !== -1) {
          return
        }
      }

      links.push(normalized)
    })
    return links
  }

  const disallowedPaths: string[] = []
  async function checkRobotsTxt(baseDomain: string) {
    if (!respectRobotsTxt) {
      return
    }
    try {
      const robotsUrl = new URL('/robots.txt', url).href
      const resp = await fetch(robotsUrl, {
        headers: { 'User-Agent': userAgent },
      })
      if (!resp.ok) {
        return
      }
      const text = await resp.text()
      const lines = text.split('\n')
      let isRelevant = false
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trim()
        if (line.toLowerCase().indexOf('user-agent:') === 0) {
          const agent = line.substring(11).trim().toLowerCase()
          isRelevant = agent === '*' || userAgent.toLowerCase().indexOf(agent) !== -1
        } else if (isRelevant && line.toLowerCase().indexOf('disallow:') === 0) {
          const path = line.substring(9).trim()
          if (path) {
            disallowedPaths.push(path)
          }
        }
      }
    } catch (e) {
      /* robots.txt not available, allow all */
    }
  }

  function isAllowedByRobots(pageUrl: string) {
    if (disallowedPaths.length === 0) {
      return true
    }
    try {
      const parsed = new URL(pageUrl)
      const path = parsed.pathname
      for (let di = 0; di < disallowedPaths.length; di++) {
        if (path.indexOf(disallowedPaths[di]) === 0) {
          return false
        }
      }
      return true
    } catch (e) {
      return true
    }
  }

  try {
    if (!crawl) {
      const pageResult = await fetchPage(url)
      if (pageResult.error) {
        return { content: null, statusCode: pageResult.status, error: pageResult.error }
      }
      const $ = cheerio.load(pageResult.html)
      const extracted = extractContent($, url)
      return {
        content: extracted.content,
        statusCode: pageResult.status,
        count: extracted.count,
        title: extracted.title,
        description: extracted.description,
        ogImage: extracted.ogImage,
        canonical: extracted.canonical,
        lang: extracted.lang,
        h1: extracted.h1,
      }
    }

    const baseDomain = getDomain(url)
    await checkRobotsTxt(baseDomain)

    const visited = new Set()
    const queue: Array<{ url: string; depth: number }> = [
      { url: normalizeUrl(url, url) || url, depth: 0 },
    ]
    const pages: any[] = []
    const errors: Array<{ url: string; error: string }> = []

    while (queue.length > 0 && pages.length < maxPages) {
      const item = queue.shift()!
      const pageUrl = item.url
      const depth = item.depth

      if (visited.has(pageUrl)) {
        continue
      }
      visited.add(pageUrl)

      if (!isAllowedByRobots(pageUrl)) {
        errors.push({ url: pageUrl, error: 'Blocked by robots.txt' })
        continue
      }

      if (pages.length > 0) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 200)
        })
      }

      const result = await fetchPage(pageUrl)
      if (result.error) {
        errors.push({ url: pageUrl, error: result.error })
        continue
      }

      const $page = cheerio.load(result.html)
      const pageData = extractContent($page, pageUrl)
      pageData.depth = depth
      pageData.statusCode = result.status
      pages.push(pageData)

      if (depth < maxDepth) {
        const links = extractLinks($page, pageUrl, baseDomain)
        for (let li = 0; li < links.length; li++) {
          if (!visited.has(links[li]) && pages.length + queue.length < maxPages * 2) {
            queue.push({ url: links[li], depth: depth + 1 })
          }
        }
      }
    }

    return {
      content: pages,
      statusCode: 200,
      pagesScraped: pages.length,
      pagesWithErrors: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      domain: baseDomain,
      maxDepthReached: pages.some(function (p: any) {
        return p.depth === maxDepth
      }),
    }
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      return { content: null, statusCode: 0, error: 'Request timed out after ' + timeout + 'ms' }
    }
    return { content: null, statusCode: 0, error: (err as Error).message }
  }
}
export const utilityScrapeWebsite: NodeHandlerGenerator = {
  nodeType: 'utility-scrape-website',
  executionEnv: 'server',
  dependencies: {
    cheerio: '^1.0.0-rc.12',
  },
  generateHandler(): string {
    return handlerToString(utility_scrape_website)
  },
}
