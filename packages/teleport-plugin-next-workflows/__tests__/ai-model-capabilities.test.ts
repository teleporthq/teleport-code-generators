import {
  generateAIProviderUtils,
  generateAIStreamingProviderUtils,
} from '../src/nodes/ai/ai-provider-utils'
import { aiCustomPrompt } from '../src/nodes/ai/ai-custom-prompt'

/**
 * The AI utils are emitted by serialising real functions into the generated
 * handler file, so the only way to test them is to evaluate the emitted source
 * exactly as the generated app would.
 */
function loadUtils() {
  const source = generateAIProviderUtils()
  // eslint-disable-next-line no-new-func
  return new Function(
    `${source}
    return {
      detectProvider: __ai_detectProvider,
      resolveProvider: __ai_resolveProvider,
      modelCapabilities: __ai_modelCapabilities,
      providerBaseURL: __ai_providerBaseURL,
      openAICompatibleBody: __ai_openAICompatibleBody,
      clampTemperature: __ai_clampTemperature,
    };`
  )() as {
    detectProvider: (modelId: string) => string
    resolveProvider: (config: unknown) => string
    modelCapabilities: (provider: string, model: string, maxTokens?: number) => any
    providerBaseURL: (provider: string) => string | undefined
    openAICompatibleBody: (
      caps: any,
      model: string,
      systemMessage: string | undefined,
      userMessage: string,
      temperature: number,
      jsonMode: boolean
    ) => any
    clampTemperature: (temp: unknown, provider: string) => number
  }
}

describe('__ai_resolveProvider', () => {
  const utils = loadUtils()

  it('prefers the explicit provider over the model id', () => {
    expect(utils.resolveProvider({ provider: 'anthropic', model: 'gpt-4o' })).toBe('anthropic')
  })

  it('falls back to inference for legacy nodes with no provider', () => {
    expect(utils.resolveProvider({ model: 'claude-opus-5' })).toBe('anthropic')
  })

  it('ignores a blank provider', () => {
    expect(utils.resolveProvider({ provider: '  ', model: 'gemini-2.5-flash' })).toBe('google')
  })
})

describe('__ai_detectProvider covers the shipped catalogue', () => {
  const utils = loadUtils()

  const CASES: Array<[string, string]> = [
    ['gpt-4o-mini', 'openai'],
    ['gpt-5.1', 'openai'],
    ['o3', 'openai'],
    ['o4-mini', 'openai'],
    ['claude-opus-5', 'anthropic'],
    ['claude-3-5-sonnet-20241022', 'anthropic'],
    ['gemini-2.5-flash', 'google'],
    ['command-a-03-2025', 'cohere'],
    ['command-r-plus-08-2024', 'cohere'],
    ['mistral-large-latest', 'mistral'],
    ['magistral-medium-latest', 'mistral'],
    ['ministral-8b-latest', 'mistral'],
    ['pixtral-large-latest', 'mistral'],
    ['open-mixtral-8x7b', 'mistral'],
    ['open-mistral-nemo', 'mistral'],
    ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta'],
    ['llama-3.1-405b', 'meta'],
    ['sonar-pro', 'perplexity'],
    ['sonar-deep-research', 'perplexity'],
    // Perplexity's retired ids begin with `llama-`; they must not be claimed by
    // the Meta branch, which would send them to Together with a Perplexity key.
    ['llama-3.1-sonar-large-128k-online', 'perplexity'],
  ]

  it.each(CASES)('%s -> %s', (modelId, provider) => {
    expect(utils.detectProvider(modelId)).toBe(provider)
  })

  it('defaults to openai for an unknown id', () => {
    expect(utils.detectProvider('something-new')).toBe('openai')
    expect(utils.detectProvider('')).toBe('openai')
  })
})

describe('__ai_modelCapabilities', () => {
  const utils = loadUtils()

  it('drops temperature for Anthropic models that reject it', () => {
    for (const model of [
      'claude-fable-5',
      'claude-mythos-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-5',
    ]) {
      expect(utils.modelCapabilities('anthropic', model, 500).supportsTemperature).toBe(false)
    }
  })

  it('keeps temperature for Anthropic models that still accept it', () => {
    for (const model of [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-3-opus-20240229',
    ]) {
      expect(utils.modelCapabilities('anthropic', model, 500).supportsTemperature).toBe(true)
    }
  })

  it('switches OpenAI reasoning models to max_completion_tokens', () => {
    const caps = utils.modelCapabilities('openai', 'o3', 500)
    expect(caps.maxTokensParam).toBe('max_completion_tokens')
    expect(caps.supportsTemperature).toBe(false)
  })

  it('raises a too-small budget on reasoning models so the answer is not empty', () => {
    // The budget also pays for hidden reasoning tokens: at 200 the model can
    // spend the whole allowance thinking and return an empty string with a 200.
    expect(utils.modelCapabilities('openai', 'o3', 200).maxTokens).toBe(2000)
    expect(utils.modelCapabilities('openai', 'gpt-5', 200).maxTokens).toBe(2000)
    // A generous budget is left alone.
    expect(utils.modelCapabilities('openai', 'o3', 8000).maxTokens).toBe(8000)
  })

  it('always yields a positive max_tokens, which Anthropic requires', () => {
    expect(utils.modelCapabilities('anthropic', 'claude-opus-5', undefined).maxTokens).toBe(1024)
    expect(utils.modelCapabilities('anthropic', 'claude-opus-5', 0).maxTokens).toBe(1024)
  })

  it('leaves ordinary chat models untouched', () => {
    const caps = utils.modelCapabilities('openai', 'gpt-4o-mini', 500)
    expect(caps).toMatchObject({
      supportsTemperature: true,
      maxTokensParam: 'max_tokens',
      maxTokens: 500,
    })
  })
})

describe('__ai_openAICompatibleBody', () => {
  const utils = loadUtils()

  it('omits temperature and uses max_completion_tokens for reasoning models', () => {
    const caps = utils.modelCapabilities('openai', 'gpt-5', 4000)
    const body = utils.openAICompatibleBody(caps, 'gpt-5', 'sys', 'hi', 0.7, false)
    expect(body.temperature).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBe(4000)
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('sends temperature and max_tokens for an ordinary model', () => {
    const caps = utils.modelCapabilities('openai', 'gpt-4o', 500)
    const body = utils.openAICompatibleBody(caps, 'gpt-4o', undefined, 'hi', 0.2, true)
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(500)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('__ai_providerBaseURL', () => {
  const utils = loadUtils()

  it('routes Meta through Together and Perplexity through its own host', () => {
    expect(utils.providerBaseURL('meta')).toBe('https://api.together.xyz/v1')
    expect(utils.providerBaseURL('perplexity')).toBe('https://api.perplexity.ai')
  })

  it('leaves first-party OpenAI on the default host', () => {
    expect(utils.providerBaseURL('openai')).toBeUndefined()
  })
})

describe('__ai_clampTemperature', () => {
  const utils = loadUtils()

  it('clamps to the provider range', () => {
    expect(utils.clampTemperature(1.8, 'anthropic')).toBe(1)
    expect(utils.clampTemperature(1.8, 'openai')).toBe(1.8)
    expect(utils.clampTemperature(-1, 'openai')).toBe(0)
  })

  it('falls back to 0.7 for a non-numeric value', () => {
    expect(utils.clampTemperature('hot', 'openai')).toBe(0.7)
    expect(utils.clampTemperature(NaN, 'openai')).toBe(0.7)
  })
})

describe('generated handlers reference the provider resolver', () => {
  it('emits __ai_resolveProvider in the custom-prompt handler', () => {
    const handler = aiCustomPrompt.generateHandler()
    expect(handler).toContain('__ai_resolveProvider(config)')
    expect(handler).not.toContain('__ai_detectProvider(model)')
  })

  it('defines every helper the streaming path calls', () => {
    const streaming = generateAIStreamingProviderUtils()
    for (const symbol of [
      '__ai_modelCapabilities',
      '__ai_providerBaseURL',
      '__ai_openAICompatibleBody',
      '__ai_callProviderStreaming',
      '__ai_handleStreamingCall',
    ]) {
      expect(streaming).toContain(symbol)
    }
  })

  it('evaluates the streaming bundle without a reference error', () => {
    // eslint-disable-next-line no-new-func
    const load = new Function(
      `${generateAIStreamingProviderUtils()}
      return typeof __ai_callProviderStreaming === 'function' && typeof __ai_handleStreamingCall === 'function';`
    )
    expect(load()).toBe(true)
  })
})
