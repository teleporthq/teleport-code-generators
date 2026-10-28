import { nodeRegistry } from './index'

/**
 * The node types whose run spends the site's money or reaches outside it: AI
 * models, mail and SMS providers, payment providers, integrations, and every
 * node that fetches a URL the site does not own. A server segment that runs
 * one is rate-limited per visitor whatever the page's protection (see the
 * abuse gate in api-route-generator.ts).
 *
 * One set beside the node registry. `cost-bearing-node-types.test.ts` reads
 * every registered node's server source and fails when one that calls an AI
 * provider, a mail / SMS / payment provider or an outbound URL is missing here
 * — a new node of that kind has to be named before it ships.
 */
const COST_BEARING_PREFIXES = ['ai-', 'email-', 'sms-', 'payment-', 'integration-']

const OUTBOUND_NODE_TYPES = [
  'general-http-request',
  'utility-scrape-website',
  'utility-extract-links',
  'utility-pdf-extract-text',
  'utility-youtube-transcript',
  'utility-ocr-extract-text',
  // Its semantic mode embeds both texts through the owner's OpenAI key.
  'utility-similarity-scoring',
  'transform-image',
  'transform-color',
  'transform-geolocation',
  'push-send-notification',
  // Mails a confirmation or a welcome through the site's provider, inside the
  // newsletter helper (the node's own source shows no provider call).
  'newsletter-subscribe',
]

const hasCostBearingPrefix = (type: string): boolean =>
  COST_BEARING_PREFIXES.some((prefix) => type.startsWith(prefix))

export const COST_BEARING_NODE_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(nodeRegistry).filter(hasCostBearingPrefix),
  ...OUTBOUND_NODE_TYPES,
])

/** A registered cost-bearing type, or any type named like one (an unknown `ai-…` included). */
export const isCostBearingNodeType = (type: string): boolean =>
  COST_BEARING_NODE_TYPES.has(type) || hasCostBearingPrefix(type)
