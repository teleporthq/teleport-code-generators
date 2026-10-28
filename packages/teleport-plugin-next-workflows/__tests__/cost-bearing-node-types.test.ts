import { nodeRegistry } from '../src/nodes'
import {
  COST_BEARING_NODE_TYPES,
  isCostBearingNodeType,
} from '../src/nodes/cost-bearing-node-types'

// A server segment that runs a node spending the site's money (an AI model, a
// mail / SMS / payment provider) or reaching a URL the site does not own is
// rate-limited per visitor. Which nodes those are is one set beside the
// registry; this reads every registered node's server source and fails when a
// node of that kind is missing from it, so a new one cannot ship ungated.

/** Server nodes whose only `fetch` goes to the site's own routes or a TeleportHQ platform service. */
const PLATFORM_ONLY_FETCH = new Set([
  'analytics-track-outcome',
  'cache-invalidate',
  'cart-price-order',
  'data-count',
  'data-create-item',
  'data-delete-item',
  'data-raw-query',
  'data-select',
  'data-update-item',
  'ecommerce-generate-invoice',
  'ecommerce-get-settings',
  'file-storage-delete',
  'file-storage-get-details',
  'file-storage-list',
  'page-revalidate',
  'realtime-send-channel-event',
  'realtime-send-channel-message',
])

const PROVIDER_SDKS =
  /require\(['"](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@mistralai\/mistralai|cohere-ai|@sendgrid\/mail|mailgun\.js|mailersend|postmark|resend|twilio|stripe|airtable)['"]\)/

const serverSourceOf = (type: string): string => {
  const generator = nodeRegistry[type]
  if (generator.executionEnv === 'client' && !generator.generateServerHandler) {
    return ''
  }
  return generator.generateServerHandler
    ? generator.generateServerHandler({ relativePrefix: '../../..' })
    : generator.generateHandler()
}

const reachesOutside = (type: string, source: string): string | null => {
  if (/__ai_resolveToken|__ai_callProvider|__ai_enforceCallBudget/.test(source)) {
    return 'calls an AI provider'
  }
  if (PROVIDER_SDKS.test(source)) {
    return 'loads a provider SDK'
  }
  if (/https?:\/\/(?!localhost)[a-z0-9-]+\.[a-z0-9.-]+/i.test(source)) {
    return 'names an outbound URL'
  }
  if (/\bfetch\s*\(/.test(source) && !PLATFORM_ONLY_FETCH.has(type)) {
    return 'fetches a URL'
  }
  return null
}

describe('cost-bearing node types', () => {
  it('names every registered node that spends money or reaches outside the site', () => {
    const missing: string[] = []
    for (const type of Object.keys(nodeRegistry).sort()) {
      const why = reachesOutside(type, serverSourceOf(type))
      if (why && !COST_BEARING_NODE_TYPES.has(type)) {
        missing.push(`${type} (${why})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('names every AI, mail, SMS, payment and integration node of the registry', () => {
    const prefixed = Object.keys(nodeRegistry).filter((type) =>
      /^(ai|email|sms|payment|integration)-/.test(type)
    )
    expect(prefixed.length).toBeGreaterThan(20)
    for (const type of prefixed) {
      expect(COST_BEARING_NODE_TYPES.has(type)).toBe(true)
    }
  })

  it('keeps every outbound node it names, the ones the source heuristic cannot see included', () => {
    // general-http-request, utility-youtube-transcript and utility-ocr-extract-text
    // reach outside through calls the heuristic above does not recognise: only
    // this list catches one of them being dropped from the set.
    const outbound = [
      'general-http-request',
      'utility-scrape-website',
      'utility-extract-links',
      'utility-pdf-extract-text',
      'utility-youtube-transcript',
      'utility-ocr-extract-text',
      'utility-similarity-scoring',
      'transform-image',
      'transform-color',
      'transform-geolocation',
      'push-send-notification',
    ]
    for (const type of outbound) {
      expect([type, COST_BEARING_NODE_TYPES.has(type)]).toEqual([type, true])
    }
  })

  it('counts the embedding similarity node and any unknown node named like a cost-bearing one', () => {
    expect(isCostBearingNodeType('utility-similarity-scoring')).toBe(true)
    expect(isCostBearingNodeType('ai-some-future-model')).toBe(true)
    expect(isCostBearingNodeType('general-custom-js')).toBe(false)
    expect(isCostBearingNodeType('data-select')).toBe(false)
  })

  it('counts the embedding similarity node against the site AI budget on the server', () => {
    const source = serverSourceOf('utility-similarity-scoring')
    expect(source).toContain('await __ai_enforceCallBudget()')
    expect(source).toContain("require('../../../utils/security-runtime')")
  })
})
