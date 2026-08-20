export const AI_PROVIDER_DEPENDENCIES: Record<string, string> = {
  openai: '^4.0.0',
  '@anthropic-ai/sdk': '^0.30.0',
  '@google/generative-ai': '^0.21.0',
  'cohere-ai': '^7.0.0',
  '@mistralai/mistralai': '^1.0.0',
}

// `globalName` is the STABLE name the node handlers reference (e.g.
// `__ai_resolveTextField`). They reference it through a `declare function`
// type-only declaration, so when the GUI bundles the generators with webpack
// that reference stays a free global and keeps the literal name. But `fn.name`
// here is whatever webpack renamed the real function to (e.g.
// `ai_provider_utils_ai_resolveTextField` after module concatenation). If we
// emit the definition only under `fn.name`, the handler's `__ai_resolveTextField`
// call resolves to nothing → "__ai_resolveTextField is not defined" at runtime.
// So we emit under the (possibly renamed) real name AND alias the stable global
// name to it. When not bundled (fn.name === globalName) the alias collapses to a
// harmless self-reference.
function wrapWithGuard(globalName: string, fn: (...args: any[]) => any): string {
  const realName = fn.name || globalName
  if (realName === globalName) {
    return `var ${globalName} = typeof ${globalName} !== 'undefined' ? ${globalName} : ${fn.toString()};`
  }
  return (
    `var ${realName} = typeof ${realName} !== 'undefined' ? ${realName} : ${fn.toString()};\n` +
    `var ${globalName} = typeof ${globalName} !== 'undefined' ? ${globalName} : ${realName};`
  )
}

export function generateAIProviderUtils(): string {
  return [
    wrapWithGuard('__ai_resolveTextField', __ai_resolveTextField),
    wrapWithGuard('__ai_resolveToken', __ai_resolveToken),
    wrapWithGuard('__ai_detectProvider', __ai_detectProvider),
    wrapWithGuard('__ai_resolveProvider', __ai_resolveProvider),
    wrapWithGuard('__ai_modelCapabilities', __ai_modelCapabilities),
    wrapWithGuard('__ai_providerBaseURL', __ai_providerBaseURL),
    wrapWithGuard('__ai_openAICompatibleBody', __ai_openAICompatibleBody),
    wrapWithGuard('__ai_clampTemperature', __ai_clampTemperature),
    wrapWithGuard('__ai_parseJSON', __ai_parseJSON),
    wrapWithGuard('__ai_callProvider', __ai_callProvider),
  ].join('\n\n')
}

export function generateAIStreamingProviderUtils(): string {
  return generateAIProviderUtils() + '\n\n' + AI_STREAMING_CODE
}

const AI_STREAMING_CODE = `
var __ai_callProviderStreaming = typeof __ai_callProviderStreaming !== 'undefined' ? __ai_callProviderStreaming : async function __ai_callProviderStreaming(params, onChunk) {
  const provider = params.provider;
  const model = params.model;
  const token = params.token;
  const systemMessage = params.systemMessage;
  const userMessage = params.userMessage;
  const temperature = params.temperature;
  const maxTokens = params.maxTokens;
  const caps = __ai_modelCapabilities(provider, model, maxTokens);
  const __nodeRequire = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require;

  if (provider === 'anthropic') {
    const _mod = __nodeRequire('@anthropic-ai/sdk');
    const Anthropic = _mod.default || _mod;
    const client = new Anthropic({ apiKey: token });
    const opts = { model: model, messages: [{ role: 'user', content: userMessage }], max_tokens: caps.maxTokens, stream: true };
    if (caps.supportsTemperature) { opts.temperature = temperature; }
    if (systemMessage) opts.system = systemMessage;
    const stream = await client.messages.create(opts);
    let promptTokens = 0;
    let completionTokens = 0;
    let currentBlockType = '';
    for await (const event of stream) {
      if (event.type === 'message_start' && event.message && event.message.usage) {
        promptTokens = event.message.usage.input_tokens || 0;
      }
      if (event.type === 'content_block_start' && event.content_block) {
        currentBlockType = event.content_block.type || '';
      }
      if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
        if (currentBlockType !== 'thinking') {
          await onChunk(event.delta.text);
        }
      }
      if (event.type === 'content_block_stop') {
        currentBlockType = '';
      }
      if (event.type === 'message_delta' && event.usage) {
        completionTokens = event.usage.output_tokens || 0;
      }
    }
    return { usage: { promptTokens: promptTokens, completionTokens: completionTokens, totalTokens: promptTokens + completionTokens } };
  }

  if (provider === 'google') {
    const _mod = __nodeRequire('@google/generative-ai');
    const GoogleGenerativeAI = _mod.GoogleGenerativeAI;
    const ai = new GoogleGenerativeAI(token);
    const genModel = ai.getGenerativeModel({ model: model });
    let fullPrompt = '';
    if (systemMessage) fullPrompt += systemMessage + '\\n\\n';
    fullPrompt += userMessage;
    const generationConfig = { maxOutputTokens: caps.maxTokens };
    if (caps.supportsTemperature) { generationConfig.temperature = temperature; }
    const result = await genModel.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: generationConfig
    });
    for await (const chunk of result.stream) {
      try {
        const text = chunk.text();
        if (text) await onChunk(text);
      } catch (_chunkErr) {}
    }
    const resp = await result.response;
    const meta = resp.usageMetadata || {};
    return { usage: { promptTokens: meta.promptTokenCount || 0, completionTokens: meta.candidatesTokenCount || 0, totalTokens: meta.totalTokenCount || 0 } };
  }

  if (provider === 'cohere') {
    const _mod = __nodeRequire('cohere-ai');
    const CohereClient = _mod.CohereClient;
    const client = new CohereClient({ token: token });
    const opts = { model: model, message: userMessage, maxTokens: caps.maxTokens };
    if (caps.supportsTemperature) { opts.temperature = temperature; }
    if (systemMessage) opts.preamble = systemMessage;
    const stream = await client.chatStream(opts);
    let usage = {};
    for await (const event of stream) {
      if (event.eventType === 'text-generation') {
        await onChunk(event.text);
      }
      if (event.eventType === 'stream-end' && event.response && event.response.meta && event.response.meta.tokens) {
        const tokens = event.response.meta.tokens;
        usage = { promptTokens: tokens.inputTokens || 0, completionTokens: tokens.outputTokens || 0, totalTokens: (tokens.inputTokens || 0) + (tokens.outputTokens || 0) };
      }
    }
    return { usage: usage };
  }

  if (provider === 'mistral') {
    const _mod = __nodeRequire('@mistralai/mistralai');
    const Mistral = _mod.Mistral || _mod.default || _mod;
    const client = new Mistral({ apiKey: token });
    const messages = [];
    if (systemMessage) messages.push({ role: 'system', content: systemMessage });
    messages.push({ role: 'user', content: userMessage });
    const opts = { model: model, messages: messages, maxTokens: caps.maxTokens };
    if (caps.supportsTemperature) { opts.temperature = temperature; }
    const stream = await client.chat.stream(opts);
    let usage = {};
    for await (const event of stream) {
      const delta = event.data && event.data.choices && event.data.choices[0] && event.data.choices[0].delta && event.data.choices[0].delta.content;
      if (delta) await onChunk(delta);
      if (event.data && event.data.usage) {
        usage = { promptTokens: event.data.usage.promptTokens || 0, completionTokens: event.data.usage.completionTokens || 0, totalTokens: event.data.usage.totalTokens || 0 };
      }
    }
    return { usage: usage };
  }

  const _mod = __nodeRequire('openai');
  const OpenAI = _mod.default || _mod;
  const baseURL = __ai_providerBaseURL(provider);
  const clientOpts = { apiKey: token };
  if (baseURL) clientOpts.baseURL = baseURL;
  const client = new OpenAI(clientOpts);
  const opts = __ai_openAICompatibleBody(caps, model, systemMessage, userMessage, temperature, false);
  opts.stream = true;
  opts.stream_options = { include_usage: true };
  const stream = await client.chat.completions.create(opts);
  let usage = {};
  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = { promptTokens: chunk.usage.prompt_tokens || 0, completionTokens: chunk.usage.completion_tokens || 0, totalTokens: chunk.usage.total_tokens || 0 };
    }
    const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
    if (delta) await onChunk(delta);
  }
  return { usage: usage };
};

var __ai_handleStreamingCall = typeof __ai_handleStreamingCall !== 'undefined' ? __ai_handleStreamingCall : async function __ai_handleStreamingCall(callParams, model, streamCallback) {
  let fullResponse = '';
  const streamResult = await __ai_callProviderStreaming(callParams, async function(chunk) {
    fullResponse += chunk;
    await streamCallback({ chunk: chunk, fullResponse: fullResponse, model: model });
  });
  return { response: fullResponse, model: model, usage: streamResult.usage || {} };
};
`

// ---------------------------------------------------------------------------
// All functions below are real TypeScript. The editor can lint/check them.
// At generation time they are serialised via .toString() and wrapped with a
// typeof-guard so they appear only once in the generated handler file.
// ---------------------------------------------------------------------------

function __ai_resolveTextField(val: any): string {
  if (val === null || val === undefined) {
    return ''
  }
  if (typeof val === 'string') {
    return val
  }
  if (Array.isArray(val)) {
    return val
      .map(function (v: any) {
        if (v != null) {
          return String(v)
        }
        return ''
      })
      .join('')
  }
  return String(val)
}

function __ai_resolveToken(token: any): string {
  if (!token) {
    throw new Error('AI node requires an API token')
  }

  const __env = (globalThis as any).process && (globalThis as any).process.env

  if (typeof token === 'string') {
    if (token.startsWith('WORKFLOW_SECRET_')) {
      const envVal = __env ? __env[token] : undefined
      if (!envVal) {
        throw new Error('Secret not found: ' + token)
      }
      return envVal
    }
    if (token.startsWith('teleporthq.secrets.')) {
      const envKey = token.replace('teleporthq.secrets.', '')
      const envVal2 = __env ? __env[envKey] : undefined
      if (!envVal2) {
        throw new Error('Secret not found: ' + envKey)
      }
      return envVal2
    }
    return token
  }

  if (typeof token === 'object' && token !== null) {
    if (token.type === 'dynamic' && token.content && token.content.referenceType === 'secret') {
      const secretId = token.content.id
      const secretVal = __env ? __env[secretId] : undefined
      if (!secretVal) {
        throw new Error('Secret not found: ' + secretId)
      }
      return secretVal
    }
  }

  if (typeof token === 'object') {
    throw new Error('Invalid token format')
  }

  return String(token)
}

/**
 * Last-resort provider inference for nodes saved before the editor started
 * writing `config.provider`.
 *
 * ⛔ This is a heuristic and it is WRONG for several current model ids —
 * `magistral-medium-latest` and `ministral-8b-latest` are Mistral,
 * `command-a-03-2025` is Cohere, and Together serves Llama under
 * `meta-llama/…`. Every unmatched id falls through to OpenAI and the request
 * goes to the wrong API with the wrong key. The patterns below cover the whole
 * shipped catalogue, but the durable fix is `config.provider`, which
 * `__ai_resolveProvider` prefers.
 */
function __ai_detectProvider(modelId: any): string {
  const id = String(modelId || '').toLowerCase()
  if (!id) {
    return 'openai'
  }
  // Perplexity first: its retired ids are `llama-3.1-sonar-*`, which would
  // otherwise be claimed by the Llama branch below.
  if (id.indexOf('sonar') >= 0) {
    return 'perplexity'
  }
  if (id.indexOf('gpt-') === 0 || /^o\d/.test(id)) {
    return 'openai'
  }
  if (id.indexOf('claude') === 0) {
    return 'anthropic'
  }
  if (id.indexOf('gemini') === 0) {
    return 'google'
  }
  if (id.indexOf('command') === 0) {
    return 'cohere'
  }
  if (
    id.indexOf('mistral') === 0 ||
    id.indexOf('mixtral') === 0 ||
    id.indexOf('ministral') === 0 ||
    id.indexOf('magistral') === 0 ||
    id.indexOf('pixtral') === 0 ||
    id.indexOf('codestral') === 0 ||
    id.indexOf('devstral') === 0 ||
    id.indexOf('open-mistral') === 0 ||
    id.indexOf('open-mixtral') === 0
  ) {
    return 'mistral'
  }
  if (id.indexOf('meta-llama/') === 0 || id.indexOf('llama') === 0) {
    return 'meta'
  }
  return 'openai'
}

/** The provider a node will call: explicit config wins, inference is fallback. */
function __ai_resolveProvider(config: any): string {
  const explicit = config && config.provider
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim()
  }
  return __ai_detectProvider(config && config.model)
}

/**
 * Request-shape rules that differ per model. Getting these wrong is a hard 400,
 * not a degraded answer:
 *
 *  - Anthropic removed `temperature` from Opus 4.7 onward, Sonnet 5 onward, and
 *    the Fable / Mythos line. Sending one fails the request outright.
 *  - OpenAI's reasoning models (`o1`, `o3`, `o4-mini`, every `gpt-5*`) replaced
 *    `max_tokens` with `max_completion_tokens` and reject a custom temperature.
 *    Their budget also covers hidden reasoning tokens, so a small cap is spent
 *    thinking and the answer comes back EMPTY with no error — hence the floor.
 *
 * Mirrored in the editor by `getAIModelCapabilities`
 * (`features/workflows/constants/ai-providers/capabilities.ts`), which uses the
 * same rules to hide the Temperature field. Keep the two in sync.
 */
function __ai_modelCapabilities(provider: any, model: any, requestedMaxTokens: any): any {
  const id = String(model || '').toLowerCase()
  // Anthropic rejects a request with no max_tokens at all, so every provider
  // gets a concrete number rather than `undefined`.
  const requested =
    typeof requestedMaxTokens === 'number' && requestedMaxTokens > 0 ? requestedMaxTokens : 1024
  const caps: any = {
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    maxTokens: requested,
    reasoningModel: false,
  }

  if (provider === 'anthropic') {
    const match = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id)
    if (match) {
      const family = match[1]
      const major = parseInt(match[2], 10)
      const minor = match[3] ? parseInt(match[3], 10) : 0
      if (family === 'fable' || family === 'mythos') {
        caps.supportsTemperature = false
      } else if (family === 'opus' && (major > 4 || (major === 4 && minor >= 7))) {
        caps.supportsTemperature = false
      } else if (family === 'sonnet' && major >= 5) {
        caps.supportsTemperature = false
      }
    }
    return caps
  }

  if (provider === 'openai' && (/^o\d/.test(id) || id.indexOf('gpt-5') === 0)) {
    caps.supportsTemperature = false
    caps.maxTokensParam = 'max_completion_tokens'
    caps.reasoningModel = true
    // The budget covers hidden reasoning tokens as well as the visible answer.
    // Below this floor the model can spend the whole allowance thinking and
    // return an EMPTY string with a normal 200 — a silent failure in a live
    // chat. The editor states the same floor next to the Max Tokens field.
    if (caps.maxTokens < 2000) {
      caps.maxTokens = 2000
    }
    return caps
  }

  return caps
}

/** Floor applied to OpenAI reasoning models — see `__ai_modelCapabilities`. */
export const AI_REASONING_MODEL_MIN_TOKENS = 2000

/** The OpenAI-compatible base URL a provider is reached on, or undefined. */
function __ai_providerBaseURL(provider: any): string | undefined {
  if (provider === 'perplexity') {
    return 'https://api.perplexity.ai'
  }
  if (provider === 'meta') {
    // Llama has no first-party inference API — Together AI serves it over an
    // OpenAI-compatible endpoint, which is why Meta model ids are Together's
    // namespaced `meta-llama/…` ones and the key is a Together key.
    return 'https://api.together.xyz/v1'
  }
  return undefined
}

/**
 * Builds a Chat Completions request body honouring the model's capabilities:
 * the right output-token field, and `temperature` only where it is accepted.
 */
function __ai_openAICompatibleBody(
  caps: any,
  model: any,
  systemMessage: any,
  userMessage: any,
  temperature: any,
  jsonMode: any
): any {
  const messages: any[] = []
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage })
  }
  messages.push({ role: 'user', content: userMessage })

  const opts: any = { model, messages }
  opts[caps.maxTokensParam] = caps.maxTokens
  if (caps.supportsTemperature) {
    opts.temperature = temperature
  }
  if (jsonMode) {
    opts.response_format = { type: 'json_object' }
  }
  return opts
}

function __ai_clampTemperature(temp: any, provider: string): number {
  // ⛔ Must stay aligned with DEFAULT_TEMPERATURE_RANGES in the editor
  // (`features/workflows/constants/ai-providers/capabilities.ts`), or the
  // inspector will accept a value the runtime silently rewrites.
  const ranges: Record<string, number[]> = {
    openai: [0, 2],
    anthropic: [0, 1],
    google: [0, 2],
    cohere: [0, 1],
    mistral: [0, 1],
    meta: [0, 2],
    perplexity: [0, 2],
  }
  const range = ranges[provider] || [0, 2]
  if (typeof temp !== 'number' || isNaN(temp)) {
    return 0.7
  }
  return Math.max(range[0], Math.min(range[1], temp))
}

function __ai_parseJSON(text: any): any {
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch (_e) {
    /* fall through */
  }
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch (_e2) {
      /* fall through */
    }
  }
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0])
    } catch (_e3) {
      /* fall through */
    }
  }
  return null
}

async function __ai_callProvider(params: any): Promise<any> {
  const provider = params.provider
  const model = params.model
  const token = params.token
  const systemMessage = params.systemMessage
  const userMessage = params.userMessage
  const temperature = params.temperature
  const jsonMode = params.jsonMode || false
  const caps = __ai_modelCapabilities(provider, model, params.maxTokens)
  const __nodeRequire =
    typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require

  if (provider === 'anthropic') {
    return (async function () {
      const _mod = __nodeRequire('@anthropic-ai/sdk')
      const Anthropic = _mod.default || _mod
      const client = new Anthropic({ apiKey: token })
      const opts: any = {
        model,
        messages: [{ role: 'user', content: userMessage }],
        // Anthropic requires max_tokens on every request; the capability
        // resolver guarantees a positive number.
        max_tokens: caps.maxTokens,
      }
      if (caps.supportsTemperature) {
        opts.temperature = temperature
      }
      if (systemMessage) {
        opts.system = systemMessage
      }
      const response = await client.messages.create(opts)
      let text = ''
      if (response.content && Array.isArray(response.content)) {
        for (let ci = 0; ci < response.content.length; ci++) {
          if (response.content[ci].text) {
            text += response.content[ci].text
          }
        }
      }
      const usage = response.usage || {}
      return {
        content: text,
        usage: {
          promptTokens: usage.input_tokens || 0,
          completionTokens: usage.output_tokens || 0,
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        },
      }
    })()
  }

  if (provider === 'google') {
    return (async function () {
      const _mod = __nodeRequire('@google/generative-ai')
      const GoogleGenerativeAI = _mod.GoogleGenerativeAI
      const ai = new GoogleGenerativeAI(token)
      const genModel = ai.getGenerativeModel({ model })
      let fullPrompt = ''
      if (systemMessage) {
        fullPrompt += systemMessage + '\n\n'
      }
      fullPrompt += userMessage
      const generationConfig: any = { maxOutputTokens: caps.maxTokens }
      if (caps.supportsTemperature) {
        generationConfig.temperature = temperature
      }
      if (jsonMode) {
        generationConfig.responseMimeType = 'application/json'
      }
      const result = await genModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig,
      })
      const resp = result.response
      const meta = resp.usageMetadata || {}
      return {
        content: resp.text(),
        usage: {
          promptTokens: meta.promptTokenCount || 0,
          completionTokens: meta.candidatesTokenCount || 0,
          totalTokens: meta.totalTokenCount || 0,
        },
      }
    })()
  }

  if (provider === 'cohere') {
    return (async function () {
      const _mod = __nodeRequire('cohere-ai')
      const CohereClient = _mod.CohereClient
      const client = new CohereClient({ token })
      const opts: any = {
        model,
        message: userMessage,
        maxTokens: caps.maxTokens,
      }
      if (caps.supportsTemperature) {
        opts.temperature = temperature
      }
      if (systemMessage) {
        opts.preamble = systemMessage
      }
      const response = await client.chat(opts)
      const meta = response.meta && response.meta.tokens ? response.meta.tokens : {}
      return {
        content: response.text || '',
        usage: {
          promptTokens: meta.inputTokens || 0,
          completionTokens: meta.outputTokens || 0,
          totalTokens: (meta.inputTokens || 0) + (meta.outputTokens || 0),
        },
      }
    })()
  }

  if (provider === 'mistral') {
    return (async function () {
      const _mod = __nodeRequire('@mistralai/mistralai')
      const Mistral = _mod.Mistral || _mod.default || _mod
      const client = new Mistral({ apiKey: token })
      const messages: any[] = []
      if (systemMessage) {
        messages.push({ role: 'system', content: systemMessage })
      }
      messages.push({ role: 'user', content: userMessage })
      const opts: any = {
        model,
        messages,
        maxTokens: caps.maxTokens,
      }
      if (caps.supportsTemperature) {
        opts.temperature = temperature
      }
      if (jsonMode) {
        opts.responseFormat = { type: 'json_object' }
      }
      const response = await client.chat.complete(opts)
      const choice = response.choices && response.choices[0] ? response.choices[0] : ({} as any)
      const usage = response.usage || {}
      return {
        content: (choice.message && choice.message.content) || '',
        usage: {
          promptTokens: usage.promptTokens || 0,
          completionTokens: usage.completionTokens || 0,
          totalTokens: usage.totalTokens || 0,
        },
      }
    })()
  }

  // openai, meta (via Together), perplexity, or an unknown provider — all
  // reachable through the OpenAI-compatible Chat Completions shape.
  return (async function () {
    const _mod = __nodeRequire('openai')
    const OpenAI = _mod.default || _mod
    const baseURL = __ai_providerBaseURL(provider)
    const clientOpts: any = { apiKey: token }
    if (baseURL) {
      clientOpts.baseURL = baseURL
    }
    const client = new OpenAI(clientOpts)
    // Only first-party OpenAI implements JSON mode; the compatible endpoints
    // reject the parameter, so it is dropped for them.
    const opts = __ai_openAICompatibleBody(
      caps,
      model,
      systemMessage,
      userMessage,
      temperature,
      jsonMode && !baseURL
    )
    const completion = await client.chat.completions.create(opts)
    const usage = completion.usage || {}
    return {
      content:
        (completion.choices[0] &&
          completion.choices[0].message &&
          completion.choices[0].message.content) ||
        '',
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
    }
  })()
}
