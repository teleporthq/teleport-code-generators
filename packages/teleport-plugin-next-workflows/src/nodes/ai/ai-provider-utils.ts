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
  const __nodeRequire = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require;

  if (provider === 'openai') {
    const _mod = __nodeRequire('openai');
    const OpenAI = _mod.default || _mod;
    const messages = [];
    if (systemMessage) messages.push({ role: 'system', content: systemMessage });
    messages.push({ role: 'user', content: userMessage });
    const client = new OpenAI({ apiKey: token });
    const opts = { model: model, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } };
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
  }

  if (provider === 'anthropic') {
    const _mod = __nodeRequire('@anthropic-ai/sdk');
    const Anthropic = _mod.default || _mod;
    const client = new Anthropic({ apiKey: token });
    const opts = { model: model, messages: [{ role: 'user', content: userMessage }], temperature: temperature, max_tokens: maxTokens || 1024, stream: true };
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
    const result = await genModel.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: { temperature: temperature, maxOutputTokens: maxTokens }
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
    const opts = { model: model, message: userMessage, temperature: temperature, maxTokens: maxTokens };
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
    const stream = await client.chat.stream({ model: model, messages: messages, temperature: temperature, maxTokens: maxTokens });
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
  const baseURL = provider === 'perplexity' ? 'https://api.perplexity.ai' : provider === 'meta' ? 'https://api.together.xyz/v1' : undefined;
  const clientOpts = { apiKey: token };
  if (baseURL) clientOpts.baseURL = baseURL;
  const client = new OpenAI(clientOpts);
  const messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  const opts = { model: model, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } };
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

function __ai_detectProvider(modelId: any): string {
  if (!modelId) {
    return 'openai'
  }
  if (modelId.startsWith('gpt-')) {
    return 'openai'
  }
  if (modelId.startsWith('claude-')) {
    return 'anthropic'
  }
  if (modelId.startsWith('gemini-')) {
    return 'google'
  }
  if (modelId.startsWith('command')) {
    return 'cohere'
  }
  if (modelId.startsWith('mistral-') || modelId.startsWith('mixtral-') || modelId === 'pixtral') {
    return 'mistral'
  }
  if (modelId.indexOf('sonar') >= 0) {
    return 'perplexity'
  }
  if (modelId.startsWith('llama-')) {
    return 'meta'
  }
  return 'openai'
}

function __ai_clampTemperature(temp: any, provider: string): number {
  const ranges: Record<string, number[]> = {
    openai: [0, 2],
    anthropic: [0, 1],
    google: [0, 1],
    cohere: [0, 5],
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
  const maxTokens = params.maxTokens
  const jsonMode = params.jsonMode || false
  const __nodeRequire =
    typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require

  if (provider === 'openai') {
    return (async function () {
      const _mod = __nodeRequire('openai')
      const OpenAI = _mod.default || _mod
      const messages: any[] = []
      if (systemMessage) {
        messages.push({ role: 'system', content: systemMessage })
      }
      messages.push({ role: 'user', content: userMessage })
      const client = new OpenAI({ apiKey: token })
      const opts: any = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }
      if (jsonMode) {
        opts.response_format = { type: 'json_object' }
      }
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

  if (provider === 'anthropic') {
    return (async function () {
      const _mod = __nodeRequire('@anthropic-ai/sdk')
      const Anthropic = _mod.default || _mod
      const client = new Anthropic({ apiKey: token })
      const opts: any = {
        model,
        messages: [{ role: 'user', content: userMessage }],
        temperature,
        max_tokens: maxTokens || 1024,
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
      const result = await genModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
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
        temperature,
        maxTokens,
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
      const response = await client.chat.complete({
        model,
        messages,
        temperature,
        maxTokens,
      })
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

  // meta, perplexity, or unknown → OpenAI-compatible
  return (async function () {
    const _mod = __nodeRequire('openai')
    const OpenAI = _mod.default || _mod
    const baseURL =
      provider === 'perplexity'
        ? 'https://api.perplexity.ai'
        : provider === 'meta'
        ? 'https://api.together.xyz/v1'
        : undefined
    const clientOpts: any = { apiKey: token }
    if (baseURL) {
      clientOpts.baseURL = baseURL
    }
    const client = new OpenAI(clientOpts)
    const messages: any[] = []
    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage })
    }
    messages.push({ role: 'user', content: userMessage })
    const opts: any = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }
    if (jsonMode && !baseURL) {
      opts.response_format = { type: 'json_object' }
    }
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
