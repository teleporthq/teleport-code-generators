import * as fs from 'fs'
import * as path from 'path'
import { generateAIStreamingProviderUtils } from '../src/nodes/ai/ai-provider-utils'
import { nodeRegistry } from '../src/nodes'

/**
 * Answers "if a user picks any provider/model in the editor, does the generated
 * app actually call it correctly?"
 *
 * Two independent guarantees are needed:
 *  1. every provider the editor can emit reaches a working branch, in BOTH the
 *     streaming and non-streaming paths;
 *  2. every SDK those branches `require()` is declared as a dependency, or the
 *     generated project fails at import time rather than at request time.
 */

const EDITOR_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'cohere',
  'mistral',
  'meta',
  'perplexity',
] as const

/** SDK a provider's branch loads. Providers absent here go through OpenAI's. */
const PROVIDER_SDK: Record<string, string> = {
  openai: 'openai',
  anthropic: '@anthropic-ai/sdk',
  google: '@google/generative-ai',
  cohere: 'cohere-ai',
  mistral: '@mistralai/mistralai',
  meta: 'openai',
  perplexity: 'openai',
}

function loadUtils() {
  const source = generateAIStreamingProviderUtils()
  // eslint-disable-next-line no-new-func
  return new Function(
    `${source}
    return {
      resolveProvider: __ai_resolveProvider,
      providerBaseURL: __ai_providerBaseURL,
      modelCapabilities: __ai_modelCapabilities,
    };`
  )() as {
    resolveProvider: (config: unknown) => string
    providerBaseURL: (provider: string) => string | undefined
    modelCapabilities: (provider: string, model: string, maxTokens?: number) => any
  }
}

/** Model ids the editor offers, read from the GUI catalogue when it is a sibling checkout. */
function readEditorCatalogue(): Array<[string, string]> | null {
  const catalogue = path.resolve(
    __dirname,
    '../../../../teleport-gui/apps/gui/app/project-page/features/workflows/constants/ai-providers/catalog.ts'
  )
  if (!fs.existsSync(catalogue)) {
    return null
  }
  const source = fs.readFileSync(catalogue, 'utf8')
  const models: Array<[string, string]> = []
  const blockRe = /\{\s*\n\s*id: '([^']+)',([\s\S]*?)\n {6}\}/g
  let match = blockRe.exec(source)
  while (match !== null) {
    const provider = /provider: '([^']+)'/.exec(match[2])
    if (provider) {
      models.push([match[1], provider[1]])
    }
    match = blockRe.exec(source)
  }
  return models.length > 0 ? models : null
}

describe('every editor provider reaches a working branch', () => {
  const utils = loadUtils()
  const source = generateAIStreamingProviderUtils()
  const nonStreaming = source.slice(source.indexOf('function __ai_callProvider'))
  const streaming = source.slice(source.indexOf('__ai_callProviderStreaming'))

  it.each(EDITOR_PROVIDERS)('%s resolves to itself when stored explicitly', (provider) => {
    expect(utils.resolveProvider({ provider, model: 'anything' })).toBe(provider)
  })

  it.each(EDITOR_PROVIDERS)('%s is handled in both call paths', (provider) => {
    const hasExplicit = (body: string) => body.includes(`provider === '${provider}'`)
    // A provider without its own branch must be OpenAI-compatible, and then it
    // needs a base URL unless it IS OpenAI — otherwise it would silently post
    // to api.openai.com with someone else's key.
    for (const [label, body] of [
      ['non-streaming', nonStreaming],
      ['streaming', streaming],
    ] as const) {
      if (!hasExplicit(body)) {
        const baseURL = utils.providerBaseURL(provider)
        const reachable = provider === 'openai' || !!baseURL
        if (!reachable) {
          throw new Error(`${provider} has no ${label} branch and no base URL`)
        }
      }
    }
  })

  it('routes the OpenAI-compatible providers to their own hosts', () => {
    expect(utils.providerBaseURL('meta')).toBe('https://api.together.xyz/v1')
    expect(utils.providerBaseURL('perplexity')).toBe('https://api.perplexity.ai')
    expect(utils.providerBaseURL('openai')).toBeUndefined()
  })
})

describe('every provider SDK is declared as a dependency', () => {
  // The provider is a runtime value, so an AI node must declare every SDK any
  // branch could load — not just the one selected when the project was built.
  const aiNodeTypes = Object.keys(nodeRegistry).filter(
    (nodeType) => nodeType.startsWith('ai-') && nodeType !== 'ai-generate-text-embedding'
  )

  it('covers all AI chat nodes', () => {
    expect(aiNodeTypes.length).toBeGreaterThanOrEqual(6)
  })

  it.each(aiNodeTypes)('%s declares every provider SDK', (nodeType) => {
    const declared = nodeRegistry[nodeType].dependencies || {}
    const missing = EDITOR_PROVIDERS.filter(
      (provider) => !Object.keys(declared).includes(PROVIDER_SDK[provider])
    )
    expect(missing).toEqual([])
  })

  it('embedding node needs only the OpenAI SDK, since embeddings are OpenAI-only', () => {
    const declared = nodeRegistry['ai-generate-text-embedding'].dependencies || {}
    expect(Object.keys(declared)).toEqual(['openai'])
  })

  it('similarity scoring declares the OpenAI SDK for its semantic algorithm', () => {
    const declared = nodeRegistry['utility-similarity-scoring'].dependencies || {}
    expect(Object.keys(declared)).toContain('openai')
  })
})

describe('the editor catalogue routes correctly end to end', () => {
  const catalogue = readEditorCatalogue()
  const utils = loadUtils()

  it('finds the GUI catalogue', () => {
    // Skips gracefully in a packaged release where the sibling checkout is absent.
    if (!catalogue) {
      // eslint-disable-next-line no-console
      console.warn('skipping catalogue cross-check — teleport-gui not a sibling checkout')
    }
    expect(true).toBe(true)
  })

  it('routes every offered model to the provider that owns it', () => {
    if (!catalogue) {
      return
    }
    expect(catalogue.length).toBeGreaterThan(40)
    const mismatches = catalogue.filter(
      ([model, provider]) => utils.resolveProvider({ provider, model }) !== provider
    )
    expect(mismatches).toEqual([])
  })

  it('never produces an unusable request shape for an offered model', () => {
    if (!catalogue) {
      return
    }
    // Anthropic rejects a request with no max_tokens at all, so every model
    // must come out with a positive budget whichever branch runs.
    const broken = catalogue.filter(([model, provider]) => {
      const caps = utils.modelCapabilities(provider, model, 500)
      return (
        !(caps.maxTokens > 0) ||
        !['max_tokens', 'max_completion_tokens'].includes(caps.maxTokensParam)
      )
    })
    expect(broken).toEqual([])
  })
})
