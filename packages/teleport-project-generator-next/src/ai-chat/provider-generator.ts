import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'

export function generateProviderCode(chat: UIDLAIAssistantChat): string {
  const provider = chat.aiProvider?.provider || 'openai'
  const model = chat.aiProvider?.model || 'gpt-4o'
  const secretRef = chat.aiProvider?.secretKeyReference || 'AI_API_KEY'
  const embeddingModel = chat.ragConfig.embeddingModel || 'text-embedding-3-small'

  return `// AI provider abstraction — chat completions + embeddings
const AI_PROVIDER = ${JSON.stringify(provider)};
const AI_MODEL = ${JSON.stringify(model)};
const AI_SECRET_KEY = ${JSON.stringify(secretRef)};
const EMBEDDING_MODEL = ${JSON.stringify(embeddingModel)};

function getAPIKey() {
  const key = process.env[AI_SECRET_KEY];
  if (!key) {
    throw new Error('AI provider not configured: missing env var ' + AI_SECRET_KEY);
  }
  return key;
}

${generateChatCompletionFn(provider)}

${generateStreamingChatFn(provider)}

${generateEmbeddingFn(provider)}

module.exports = {
  chatCompletion: chatCompletion,
  streamChatCompletion: streamChatCompletion,
  generateEmbedding: generateEmbedding,
  AI_PROVIDER: AI_PROVIDER,
  AI_MODEL: AI_MODEL,
};
`
}

function generateChatCompletionFn(provider: string): string {
  return `async function chatCompletion(options) {
  var systemMessage = options.systemMessage;
  var userMessage = options.userMessage;
  var temperature = options.temperature !== undefined ? options.temperature : 0.7;
  var maxTokens = options.maxTokens || 500;
  var model = options.model || AI_MODEL;
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
    temperature: temperature,
    max_tokens: maxTokens || 1024,
  };
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
  var result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: { temperature: temperature, maxOutputTokens: maxTokens },
  });
  var resp = result.response;
  return { content: resp.text(), usage: resp.usageMetadata || {} };`

    case 'cohere':
      return `  var cohereModule = require('cohere-ai');
  var client = new cohereModule.CohereClient({ token: apiKey });
  var opts = { model: model, message: userMessage, temperature: temperature, maxTokens: maxTokens };
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
  var response = await client.chat.complete({ model: model, messages: messages, temperature: temperature, maxTokens: maxTokens });
  var choice = response.choices && response.choices[0] ? response.choices[0] : {};
  return { content: (choice.message && choice.message.content) || '', usage: response.usage || {} };`

    case 'groq':
    case 'perplexity':
      return generateOpenAICompatibleBlock(provider)

    default:
      return generateOpenAICompatibleBlock('openai')
  }
}

function generateOpenAICompatibleBlock(provider: string): string {
  const baseURLLine =
    provider === 'perplexity'
      ? `  var clientOpts = { apiKey: apiKey, baseURL: 'https://api.perplexity.ai' };`
      : provider === 'groq'
      ? `  var clientOpts = { apiKey: apiKey, baseURL: 'https://api.groq.com/openai/v1' };`
      : `  var clientOpts = { apiKey: apiKey };`

  return `  var OpenAI = require('openai');
  OpenAI = OpenAI.default || OpenAI;
${baseURLLine}
  var client = new OpenAI(clientOpts);
  var messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  var completion = await client.chat.completions.create({
    model: model,
    messages: messages,
    temperature: temperature,
    max_tokens: maxTokens,
  });
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
  var maxTokens = options.maxTokens || 500;
  var model = options.model || AI_MODEL;
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
    temperature: temperature,
    max_tokens: maxTokens || 1024,
    stream: true,
  };
  if (systemMessage) { opts.system = systemMessage; }
  var stream = await client.messages.create(opts);
  var fullText = '';
  for await (var event of stream) {
    if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
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
  var result = await genModel.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: { temperature: temperature, maxOutputTokens: maxTokens },
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
  var opts = { model: model, message: userMessage, temperature: temperature, maxTokens: maxTokens };
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
  var stream = await client.chat.stream({ model: model, messages: messages, temperature: temperature, maxTokens: maxTokens });
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
  const baseURLLine =
    provider === 'perplexity'
      ? `  var clientOpts = { apiKey: apiKey, baseURL: 'https://api.perplexity.ai' };`
      : provider === 'groq'
      ? `  var clientOpts = { apiKey: apiKey, baseURL: 'https://api.groq.com/openai/v1' };`
      : `  var clientOpts = { apiKey: apiKey };`

  return `  var OpenAI = require('openai');
  OpenAI = OpenAI.default || OpenAI;
${baseURLLine}
  var client = new OpenAI(clientOpts);
  var messages = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push({ role: 'user', content: userMessage });
  var stream = await client.chat.completions.create({
    model: model,
    messages: messages,
    temperature: temperature,
    max_tokens: maxTokens,
    stream: true,
  });
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

function generateEmbeddingFn(provider: string): string {
  if (provider === 'cohere') {
    return `async function generateEmbedding(text) {
  var apiKey = getAPIKey();
  var cohereModule = require('cohere-ai');
  var client = new cohereModule.CohereClient({ token: apiKey });
  var response = await client.embed({
    texts: [text],
    model: EMBEDDING_MODEL || 'embed-english-v3.0',
    inputType: 'search_query',
  });
  if (response.embeddings && response.embeddings[0]) {
    return response.embeddings[0];
  }
  throw new Error('Failed to generate embedding');
}`
  }

  if (provider === 'google') {
    return `async function generateEmbedding(text) {
  var apiKey = getAPIKey();
  var genAI = require('@google/generative-ai');
  var ai = new genAI.GoogleGenerativeAI(apiKey);
  var embModel = ai.getGenerativeModel({ model: EMBEDDING_MODEL || 'text-embedding-004' });
  var result = await embModel.embedContent(text);
  if (result.embedding && result.embedding.values) {
    return result.embedding.values;
  }
  throw new Error('Failed to generate embedding');
}`
  }

  if (provider === 'mistral') {
    return `async function generateEmbedding(text) {
  var apiKey = getAPIKey();
  var mistralModule = require('@mistralai/mistralai');
  var Mistral = mistralModule.Mistral || mistralModule.default || mistralModule;
  var client = new Mistral({ apiKey: apiKey });
  var response = await client.embeddings.create({
    model: EMBEDDING_MODEL || 'mistral-embed',
    inputs: [text],
  });
  if (response.data && response.data[0] && response.data[0].embedding) {
    return response.data[0].embedding;
  }
  throw new Error('Failed to generate embedding');
}`
  }

  // For providers without native embedding APIs (anthropic) or OpenAI-compatible
  // ones, use OpenAI embeddings. A separate EMBEDDING_API_KEY env var can be set
  // when the chat provider key differs from the OpenAI key.
  return `async function generateEmbedding(text) {
  var apiKey = process.env.EMBEDDING_API_KEY || getAPIKey();
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
}

export function getProviderDependencies(provider: string): Record<string, string> {
  switch (provider) {
    case 'openai':
    case 'perplexity':
    case 'groq':
      return { openai: '^4.0.0' }
    case 'anthropic':
      return { '@anthropic-ai/sdk': '^0.30.0', openai: '^4.0.0' }
    case 'google':
      return { '@google/generative-ai': '^0.21.0' }
    case 'cohere':
      return { 'cohere-ai': '^7.0.0' }
    case 'mistral':
      return { '@mistralai/mistralai': '^1.0.0' }
    default:
      return { openai: '^4.0.0' }
  }
}
