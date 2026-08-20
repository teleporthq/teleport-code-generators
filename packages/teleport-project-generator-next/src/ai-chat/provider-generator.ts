import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'

/**
 * Emits `lib/ai-chat/provider.js` — the chat-completion + embedding shim the
 * generated AI-chat API routes call.
 *
 * Two invariants this file exists to hold:
 *
 *  1. **Chat completions follow the chosen provider.** Any provider in the
 *     editor's catalogue can be selected, and each has its own SDK, parameter
 *     names, and — importantly — its own set of parameters it will REJECT.
 *  2. **Embeddings are always OpenAI.** Knowledge sources are indexed by the
 *     Teleport services worker with OpenAI `text-embedding-3-small` (1536
 *     dimensions) and stored in `teleport_ai_chat_documents.embedding_json`.
 *     The query vector is compared against those stored vectors, so it has to
 *     come from the same model: a different model with the same width produces
 *     a meaningless similarity, and a different width (Cohere 1024, Gemini 768,
 *     OpenAI large 3072) makes every comparison garbage. Generating embeddings
 *     with the chat provider — which this file used to do for Google, Cohere
 *     and Mistral — silently destroys retrieval.
 */
export function generateProviderCode(chat: UIDLAIAssistantChat): string {
  const provider = chat.aiProvider?.provider || 'openai'
  const model = chat.aiProvider?.model || 'gpt-4o-mini'
  const secretRef = chat.aiProvider?.secretKeyReference || 'AI_API_KEY'
  const embeddingSecretRef = chat.aiProvider?.embeddingSecretKeyReference || ''
  const embeddingModel = chat.ragConfig.embeddingModel || 'text-embedding-3-small'

  return `// AI provider abstraction — chat completions + embeddings
const AI_PROVIDER = ${JSON.stringify(provider)};
const AI_MODEL = ${JSON.stringify(model)};
const AI_SECRET_KEY = ${JSON.stringify(secretRef)};
// Always an OpenAI key: the knowledge base is indexed with OpenAI embeddings,
// so the query vector must come from the same model whichever provider answers.
const EMBEDDING_SECRET_KEY = ${JSON.stringify(embeddingSecretRef)};
const EMBEDDING_MODEL = ${JSON.stringify(embeddingModel)};

function getAPIKey() {
  const key = process.env[AI_SECRET_KEY];
  if (!key) {
    throw new Error('AI provider not configured: missing env var ' + AI_SECRET_KEY);
  }
  return key;
}

function getEmbeddingAPIKey() {
  // EMBEDDING_API_KEY is the explicit override; then the project's OpenAI
  // secret; and finally the chat key itself, which is only valid when the chat
  // provider IS OpenAI.
  const explicit = process.env.EMBEDDING_API_KEY;
  if (explicit) return explicit;
  if (EMBEDDING_SECRET_KEY && process.env[EMBEDDING_SECRET_KEY]) {
    return process.env[EMBEDDING_SECRET_KEY];
  }
  if (AI_PROVIDER === 'openai') {
    return getAPIKey();
  }
  throw new Error(
    'Semantic search is not configured: set EMBEDDING_API_KEY to an OpenAI API key, ' +
      'or add an OpenAI key in the AI Assistant settings. The chat falls back to keyword search.'
  );
}

${MODEL_CAPABILITIES_FN}

${generateChatCompletionFn(provider)}

${generateStreamingChatFn(provider)}

${EMBEDDING_FN}

module.exports = {
  chatCompletion: chatCompletion,
  streamChatCompletion: streamChatCompletion,
  generateEmbedding: generateEmbedding,
  AI_PROVIDER: AI_PROVIDER,
  AI_MODEL: AI_MODEL,
};
`
}

/**
 * Per-model request-shape rules. Mirrors `__ai_modelCapabilities` in
 * `teleport-plugin-next-workflows/src/nodes/ai/ai-provider-utils.ts` — the two
 * runtimes must agree, because the same provider/model pair reaches both.
 */
const MODEL_CAPABILITIES_FN = `function modelCapabilities(provider, model, requestedMaxTokens) {
  var id = String(model || '').toLowerCase();
  var requested = typeof requestedMaxTokens === 'number' && requestedMaxTokens > 0 ? requestedMaxTokens : 1024;
  var caps = { supportsTemperature: true, maxTokensParam: 'max_tokens', maxTokens: requested };

  if (provider === 'anthropic') {
    // Anthropic removed sampling parameters from Opus 4.7 onward, Sonnet 5
    // onward, and the Fable / Mythos line — sending one is a 400.
    var match = /^claude-(fable|mythos|opus|sonnet|haiku)-(\\d+)(?:-(\\d+))?/.exec(id);
    if (match) {
      var family = match[1];
      var major = parseInt(match[2], 10);
      var minor = match[3] ? parseInt(match[3], 10) : 0;
      if (family === 'fable' || family === 'mythos') caps.supportsTemperature = false;
      else if (family === 'opus' && (major > 4 || (major === 4 && minor >= 7))) caps.supportsTemperature = false;
      else if (family === 'sonnet' && major >= 5) caps.supportsTemperature = false;
    }
    return caps;
  }

  if (provider === 'openai' && (/^o\\d/.test(id) || id.indexOf('gpt-5') === 0)) {
    // Reasoning models: max_completion_tokens instead of max_tokens, default
    // temperature only, and a floor because the budget also pays for hidden
    // reasoning tokens — too small a cap returns an EMPTY answer with a 200.
    caps.supportsTemperature = false;
    caps.maxTokensParam = 'max_completion_tokens';
    if (caps.maxTokens < 2000) caps.maxTokens = 2000;
    return caps;
  }

  return caps;
}`

/** Always OpenAI — see the module doc. */
const EMBEDDING_FN = `async function generateEmbedding(text) {
  var apiKey = getEmbeddingAPIKey();
  var OpenAI = require('openai');
  OpenAI = OpenAI.default || OpenAI;
  var client = new OpenAI({ apiKey: apiKey });
  var response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  if (response.data && response.data[0] && response.data[0].embedding) {
    return response.data[0].embedding;
  }
  throw new Error('Failed to generate embedding');
}`

function generateChatCompletionFn(provider: string): string {
  return `async function chatCompletion(options) {
  var systemMessage = options.systemMessage;
  var userMessage = options.userMessage;
  var temperature = options.temperature !== undefined ? options.temperature : 0.7;
  var model = options.model || AI_MODEL;
  var caps = modelCapabilities(AI_PROVIDER, model, options.maxTokens || 500);
  var apiKey = getAPIKey();

${getChatProviderBlock(provider)}
}`
}

function getChatProviderBlock(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return `  var Anthropic = require('@anthropic-ai/sdk');
  var client = new (Anthropic.default || Anthropic)({ apiKey: apiKey });
  var opts = {
    model: model,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: caps.maxTokens,
  };
  if (caps.supportsTemperature) { opts.temperature = temperature; }
  if (systemMessage) { opts.system = systemMessage; }
  var response = await client.messages.create(opts);
  var text = '';
  if (response.content && Array.isArray(response.content)) {
    for (var i = 0; i < response.content.length; i++) {
      if (response.content[i].text) text += response.content[i].text;
    }
  }
  return { content: text, usage: response.usage || {} };`

    case 'google':
      return `  var genAI = require('@google/generative-ai');
  var ai = new genAI.GoogleGenerativeAI(apiKey);
  var genModel = ai.getGenerativeModel({ model: model });
  var fullPrompt = '';
  if (systemMessage) fullPrompt += systemMessage + '\\n\\n';
  fullPrompt += userMessage;
  var generationConfig = { maxOutputTokens: caps.maxTokens };
  if (caps.supportsTemperature) { generationConfig.temperature = temperature; }
  var result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: generationConfig,
  });
  var resp = result.response;
  return { content: resp.text(), usage: resp.usageMetadata || {} };`

    case 'cohere':
      return `  var cohereModule = require('cohere-ai');
  var client = new cohereModule.CohereClient({ token: apiKey });
  var opts = { model: model, message: userMessage, maxTokens: caps.maxTokens };
  if (caps.supportsTemperature) { opts.temperature = temperature; }
  if (systemMessage) { opts.preamble = systemMessage; }
  var response = await client.chat(opts);
  return { content: response.text || '', usage: response.meta && response.meta.tokens ? response.meta.tokens : {} };`

    case 'mistral':
      return `  var mistralModule = require('@mistralai/mistralai');
  var Mistral = mistralModule.Mistral || mistralModule.default || mistralModule;
  var client = new Mistral({ apiKey: apiKey });
  var messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  var opts = { model: model, messages: messages, maxTokens: caps.maxTokens };
  if (caps.supportsTemperature) { opts.temperature = temperature; }
  var response = await client.chat.complete(opts);
  var choice = response.choices && response.choices[0] ? response.choices[0] : {};
  return { content: (choice.message && choice.message.content) || '', usage: response.usage || {} };`

    default:
      // openai, meta (via Together), perplexity, groq, or anything else that
      // speaks the OpenAI Chat Completions shape.
      return generateOpenAICompatibleBlock(provider)
  }
}

/** The OpenAI-compatible base URL a provider is reached on, or none. */
function providerBaseURL(provider: string): string | null {
  if (provider === 'perplexity') {
    return 'https://api.perplexity.ai'
  }
  if (provider === 'groq') {
    return 'https://api.groq.com/openai/v1'
  }
  if (provider === 'meta') {
    // Llama has no first-party inference API — Together AI serves it over an
    // OpenAI-compatible endpoint.
    return 'https://api.together.xyz/v1'
  }
  return null
}

function clientOptsLine(provider: string): string {
  const baseURL = providerBaseURL(provider)
  return baseURL
    ? `  var clientOpts = { apiKey: apiKey, baseURL: '${baseURL}' };`
    : `  var clientOpts = { apiKey: apiKey };`
}

function generateOpenAICompatibleBlock(provider: string): string {
  return `  var OpenAI = require('openai');
  OpenAI = OpenAI.default || OpenAI;
${clientOptsLine(provider)}
  var client = new OpenAI(clientOpts);
  var messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  var body = { model: model, messages: messages };
  body[caps.maxTokensParam] = caps.maxTokens;
  if (caps.supportsTemperature) { body.temperature = temperature; }
  var completion = await client.chat.completions.create(body);
  var usage = completion.usage || {};
  return {
    content: (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '',
    usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 },
  };`
}

function generateStreamingChatFn(provider: string): string {
  return `async function streamChatCompletion(options, onChunk) {
  var systemMessage = options.systemMessage;
  var userMessage = options.userMessage;
  var temperature = options.temperature !== undefined ? options.temperature : 0.7;
  var model = options.model || AI_MODEL;
  var caps = modelCapabilities(AI_PROVIDER, model, options.maxTokens || 500);
  var apiKey = getAPIKey();

${getStreamingProviderBlock(provider)}
}`
}

function getStreamingProviderBlock(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return `  var Anthropic = require('@anthropic-ai/sdk');
  var client = new (Anthropic.default || Anthropic)({ apiKey: apiKey });
  var opts = {
    model: model,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: caps.maxTokens,
    stream: true,
  };
  if (caps.supportsTemperature) { opts.temperature = temperature; }
  if (systemMessage) { opts.system = systemMessage; }
  var stream = await client.messages.create(opts);
  var fullText = '';
  var currentBlockType = '';
  for await (var event of stream) {
    if (event.type === 'content_block_start' && event.content_block) {
      currentBlockType = event.content_block.type || '';
    }
    if (event.type === 'content_block_stop') {
      currentBlockType = '';
    }
    // Thinking blocks are internal reasoning, not part of the reply.
    if (currentBlockType !== 'thinking' && event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      await onChunk(event.delta.text, fullText);
    }
  }
  return { content: fullText };`

    case 'google':
      return `  var genAI = require('@google/generative-ai');
  var ai = new genAI.GoogleGenerativeAI(apiKey);
  var genModel = ai.getGenerativeModel({ model: model });
  var fullPrompt = '';
  if (systemMessage) fullPrompt += systemMessage + '\\n\\n';
  fullPrompt += userMessage;
  var generationConfig = { maxOutputTokens: caps.maxTokens };
  if (caps.supportsTemperature) { generationConfig.temperature = temperature; }
  var result = await genModel.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: generationConfig,
  });
  var fullText = '';
  for await (var chunk of result.stream) {
    try {
      var text = chunk.text();
      if (text) {
        fullText += text;
        await onChunk(text, fullText);
      }
    } catch (_e) {}
  }
  return { content: fullText };`

    case 'cohere':
      return `  var cohereModule = require('cohere-ai');
  var client = new cohereModule.CohereClient({ token: apiKey });
  var opts = { model: model, message: userMessage, maxTokens: caps.maxTokens };
  if (caps.supportsTemperature) { opts.temperature = temperature; }
  if (systemMessage) { opts.preamble = systemMessage; }
  var stream = await client.chatStream(opts);
  var fullText = '';
  for await (var event of stream) {
    if (event.eventType === 'text-generation') {
      fullText += event.text;
      await onChunk(event.text, fullText);
    }
  }
  return { content: fullText };`

    case 'mistral':
      return `  var mistralModule = require('@mistralai/mistralai');
  var Mistral = mistralModule.Mistral || mistralModule.default || mistralModule;
  var client = new Mistral({ apiKey: apiKey });
  var messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  var opts = { model: model, messages: messages, maxTokens: caps.maxTokens };
  if (caps.supportsTemperature) { opts.temperature = temperature; }
  var stream = await client.chat.stream(opts);
  var fullText = '';
  for await (var event of stream) {
    var delta = event.data && event.data.choices && event.data.choices[0] && event.data.choices[0].delta && event.data.choices[0].delta.content;
    if (delta) {
      fullText += delta;
      await onChunk(delta, fullText);
    }
  }
  return { content: fullText };`

    default:
      return generateOpenAIStreamingBlock(provider)
  }
}

function generateOpenAIStreamingBlock(provider: string): string {
  return `  var OpenAI = require('openai');
  OpenAI = OpenAI.default || OpenAI;
${clientOptsLine(provider)}
  var client = new OpenAI(clientOpts);
  var messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  var body = { model: model, messages: messages, stream: true };
  body[caps.maxTokensParam] = caps.maxTokens;
  if (caps.supportsTemperature) { body.temperature = temperature; }
  var stream = await client.chat.completions.create(body);
  var fullText = '';
  for await (var chunk of stream) {
    var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
    if (delta) {
      fullText += delta;
      await onChunk(delta, fullText);
    }
  }
  return { content: fullText };`
}

/**
 * ⛔ `openai` is in every entry, not just the OpenAI one: `generateEmbedding`
 * always calls the OpenAI embeddings API, so the SDK is needed whatever the
 * chat provider is.
 */
export function getProviderDependencies(provider: string): Record<string, string> {
  const openaiDep = { openai: '^4.0.0' }
  switch (provider) {
    case 'anthropic':
      return { ...openaiDep, '@anthropic-ai/sdk': '^0.30.0' }
    case 'google':
      return { ...openaiDep, '@google/generative-ai': '^0.21.0' }
    case 'cohere':
      return { ...openaiDep, 'cohere-ai': '^7.0.0' }
    case 'mistral':
      return { ...openaiDep, '@mistralai/mistralai': '^1.0.0' }
    default:
      // openai, meta (Together), perplexity, groq — all OpenAI-compatible.
      return openaiDep
  }
}
