import { AI_PROVIDER_UTIL_SOURCES } from './ai-provider-utils-sources.generated'
import { generateSecurityRuntimeVar } from '../general/visitor-request'

declare function __ai_enforceCallBudget(prompt?: any): Promise<void>
declare function __ai_clampMaxTokens(value: any): any

/**
 * Every LLM call the site makes counts against ONE per-site daily budget, in
 * the shared durable limiter — the AI chat counts against the same key — so a
 * public AI step looped by a visitor stops at the ceiling instead of billing
 * the owner's key without end. A prompt longer than the cap is refused before
 * it is counted or sent.
 */
export const AI_SITE_CALLS_KEY = 'site:ai-calls'
export const AI_SITE_CALLS_PER_DAY = 2000
export const AI_MAX_PROMPT_CHARS = 8000
export const AI_LIMIT_REACHED_MESSAGE =
  'This site has reached its AI usage limit for today. Try again tomorrow.'
export const AI_PROMPT_TOO_LONG_MESSAGE =
  'The prompt is too long: it can be at most ' + AI_MAX_PROMPT_CHARS + ' characters.'
export const AI_UNAVAILABLE_MESSAGE = 'AI is not available right now.'
/** The most output tokens one call may ask for; a larger `maxTokens` is lowered to it (logged). */
export const AI_MAX_OUTPUT_TOKENS = 4096
/**
 * The AI refusals that name nothing secret, and the status a route answers
 * them with: a segment route shows these exact messages to the visitor instead
 * of its generic error (see the route's `__publicRefusal`), so a too-long
 * prompt or a spent daily budget reads as what it is.
 */
export const AI_PUBLIC_REFUSALS: Record<string, number> = {
  [AI_PROMPT_TOO_LONG_MESSAGE]: 400,
  [AI_LIMIT_REACHED_MESSAGE]: 429,
  [AI_UNAVAILABLE_MESSAGE]: 503,
}
/** What every other AI-node error says outside the server (the detail is logged). */
export const AI_NOT_CONFIGURED_MESSAGE = 'The AI provider is not configured.'
export const AI_REFUSED_MESSAGE = 'The AI provider refused the request.'

/**
 * Emitted ahead of the provider utils: the security runtime (`null` without a
 * route prefix, which refuses every call) and `__ai_enforceCallBudget(prompt)`,
 * which `__ai_callProvider` / `__ai_callProviderStreaming` and the embedding
 * node await before they reach a provider. It throws an Error whose message is
 * safe to show.
 *
 * And `__ai_publicMessage(err, code)`: what a node's `{ error: true, message }`
 * says. An AI node's error can leave the server (the route's reply, a
 * `continueOnError` result in the context), and a provider's message can quote
 * the key it was given — a token set to an env var's name ends up there — or a
 * secret name. The detail goes to the server log; the message is one of two
 * fixed sentences, or a refusal of this module's own.
 */
function generateAICallBudgetCode(relativePrefix?: string): string {
  return `${generateSecurityRuntimeVar('__ai_securityRuntime', relativePrefix)}

var __ai_enforceCallBudget = typeof __ai_enforceCallBudget !== 'undefined' ? __ai_enforceCallBudget : async function __ai_enforceCallBudget(prompt) {
  // An expression, not a declaration: a named two-parameter function here
  // would be taken for the node's own entry (see resolveHandlerEntryName).
  var refusal = function (message, code) {
    var error = new Error(message);
    error.code = code;
    return error;
  };
  if (typeof prompt === 'string' && prompt.length > ${AI_MAX_PROMPT_CHARS}) {
    throw refusal(${JSON.stringify(AI_PROMPT_TOO_LONG_MESSAGE)}, 'prompt_too_long');
  }
  var security = __ai_securityRuntime;
  if (!security || typeof security.rateLimit !== 'function') {
    console.error('[ai] call refused: the security runtime is not available');
    throw refusal(${JSON.stringify(AI_UNAVAILABLE_MESSAGE)}, 'ai_unavailable');
  }
  var verdict = await security.rateLimit({ key: ${JSON.stringify(
    AI_SITE_CALLS_KEY
  )}, limit: ${AI_SITE_CALLS_PER_DAY}, windowSeconds: 86400 });
  if (!verdict || !verdict.allowed) {
    console.warn('[ai] call refused: the site reached its daily AI call limit');
    throw refusal(${JSON.stringify(AI_LIMIT_REACHED_MESSAGE)}, 'ai_limit_reached');
  }
};

var __ai_publicMessage = typeof __ai_publicMessage !== 'undefined' ? __ai_publicMessage : function __ai_publicMessage(err, code) {
  console.error('[ai] ' + code + ': ' + (err && err.message ? err.message : String(err)));
  if (err && (err.code === 'prompt_too_long' || err.code === 'ai_limit_reached' || err.code === 'ai_unavailable')) {
    return err.message;
  }
  return code === 'authentication_error' ? ${JSON.stringify(
    AI_NOT_CONFIGURED_MESSAGE
  )} : ${JSON.stringify(AI_REFUSED_MESSAGE)};
};

// The code a node answers: one of this module's own refusals keeps its code
// (a workflow can branch on 'ai_limit_reached' / 'prompt_too_long'), any other
// error the node's own.
var __ai_publicCode = typeof __ai_publicCode !== 'undefined' ? __ai_publicCode : function __ai_publicCode(err, code) {
  return err && (err.code === 'prompt_too_long' || err.code === 'ai_limit_reached' || err.code === 'ai_unavailable') ? err.code : code;
};

// The output budget of one call: a node's maxTokens (it may be bound to the
// request) above the ceiling is lowered to it, and the reason is logged, so a
// visitor cannot make each of the site's daily calls cost more.
var __ai_clampMaxTokens = typeof __ai_clampMaxTokens !== 'undefined' ? __ai_clampMaxTokens : function __ai_clampMaxTokens(value) {
  var ceiling = ${AI_MAX_OUTPUT_TOKENS};
  var requested = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof requested === 'number' && isFinite(requested) && requested > ceiling) {
    console.warn('[ai] maxTokens ' + requested + ' is above the per-call ceiling of ' + ceiling + ' and was lowered to it');
    return ceiling;
  }
  return requested;
};`
}

export const AI_PROVIDER_DEPENDENCIES: Record<string, string> = {
  openai: '^4.0.0',
  '@anthropic-ai/sdk': '^0.30.0',
  '@google/generative-ai': '^0.21.0',
  'cohere-ai': '^7.0.0',
  '@mistralai/mistralai': '^1.0.0',
}

// `globalName` is the STABLE name the node handlers reference (e.g.
// `__ai_resolveTextField`) through a `declare function` type-only declaration.
// The definition is emitted as TEXT derived from this file at build time
// (scripts/function-sources.js), never from the live function: the editor
// bundles the generators with webpack + Terser, which renames module-level
// functions, so `fn.toString()` would carry a renamed, colliding name. The
// guard keeps repeated concatenation in one segment file idempotent.
function wrapWithGuard(globalName: string, source: string): string {
  return `var ${globalName} = typeof ${globalName} !== 'undefined' ? ${globalName} : ${source};`
}

/**
 * `relativePrefix`: from the route the utils are inlined into to the project
 * root. Without it no call reaches a provider (see generateAICallBudgetCode).
 */
export function generateAIProviderUtils(relativePrefix?: string): string {
  return [
    generateAICallBudgetCode(relativePrefix),
    wrapWithGuard('__ai_resolveTextField', AI_PROVIDER_UTIL_SOURCES.__ai_resolveTextField),
    wrapWithGuard('__ai_resolveToken', AI_PROVIDER_UTIL_SOURCES.__ai_resolveToken),
    wrapWithGuard('__ai_detectProvider', AI_PROVIDER_UTIL_SOURCES.__ai_detectProvider),
    wrapWithGuard('__ai_resolveProvider', AI_PROVIDER_UTIL_SOURCES.__ai_resolveProvider),
    wrapWithGuard('__ai_modelCapabilities', AI_PROVIDER_UTIL_SOURCES.__ai_modelCapabilities),
    wrapWithGuard('__ai_providerBaseURL', AI_PROVIDER_UTIL_SOURCES.__ai_providerBaseURL),
    wrapWithGuard('__ai_openAICompatibleBody', AI_PROVIDER_UTIL_SOURCES.__ai_openAICompatibleBody),
    wrapWithGuard('__ai_clampTemperature', AI_PROVIDER_UTIL_SOURCES.__ai_clampTemperature),
    wrapWithGuard('__ai_parseJSON', AI_PROVIDER_UTIL_SOURCES.__ai_parseJSON),
    wrapWithGuard('__ai_callProvider', AI_PROVIDER_UTIL_SOURCES.__ai_callProvider),
  ].join('\n\n')
}

export function generateAIStreamingProviderUtils(relativePrefix?: string): string {
  return generateAIProviderUtils(relativePrefix) + '\n\n' + AI_STREAMING_CODE
}

const AI_STREAMING_CODE = `
var __ai_callProviderStreaming = typeof __ai_callProviderStreaming !== 'undefined' ? __ai_callProviderStreaming : async function __ai_callProviderStreaming(params, onChunk) {
  await __ai_enforceCallBudget(params.userMessage);
  const provider = params.provider;
  const model = params.model;
  const token = params.token;
  const systemMessage = params.systemMessage;
  const userMessage = params.userMessage;
  const temperature = params.temperature;
  const maxTokens = params.maxTokens;
  const caps = __ai_modelCapabilities(provider, model, __ai_clampMaxTokens(maxTokens));
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
    await streamCallback({ chunk: chunk, fullResponse: fullResponse });
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
  // The reason (which secret is missing) goes to the server log only: a
  // node's error can reach the browser, and must never name an env var.
  function notConfigured(detail: string) {
    // tslint:disable-next-line:no-console
    console.error('[ai] the AI provider is not configured: ' + detail)
    return new Error('The AI provider is not configured.')
  }
  if (!token) {
    throw notConfigured('the node has no API token')
  }

  const __env = (globalThis as any).process && (globalThis as any).process.env

  if (typeof token === 'string') {
    if (token.startsWith('WORKFLOW_SECRET_')) {
      const envVal = __env ? __env[token] : undefined
      if (!envVal) {
        throw notConfigured('secret ' + token + ' is not set')
      }
      return envVal
    }
    if (token.startsWith('teleporthq.secrets.')) {
      const envKey = token.replace('teleporthq.secrets.', '')
      const envVal2 = __env ? __env[envKey] : undefined
      if (!envVal2) {
        throw notConfigured('secret ' + envKey + ' is not set')
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
        throw notConfigured('secret ' + secretId + ' is not set')
      }
      return secretVal
    }
  }

  if (typeof token === 'object') {
    throw notConfigured('the token is not a string or a secret reference')
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
  // The site's daily AI budget and the prompt cap, before any provider is reached.
  await __ai_enforceCallBudget(params.userMessage)
  const provider = params.provider
  const model = params.model
  const token = params.token
  const systemMessage = params.systemMessage
  const userMessage = params.userMessage
  const temperature = params.temperature
  const jsonMode = params.jsonMode || false
  // Lowered to the per-call ceiling first (see __ai_clampMaxTokens).
  const caps = __ai_modelCapabilities(provider, model, __ai_clampMaxTokens(params.maxTokens))
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
