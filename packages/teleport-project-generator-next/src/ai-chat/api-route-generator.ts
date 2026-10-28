import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'
import {
  AI_SITE_CALLS_KEY,
  AI_SITE_CALLS_PER_DAY as WORKFLOW_AI_SITE_CALLS_PER_DAY,
  securityRuntimeSpecifier,
} from '@teleporthq/teleport-plugin-next-workflows'
import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { collectUnknownInformationMessages } from './localized-messages'

/**
 * What keeps the chat from being a free LLM key and a public transcript store
 * (A5-H3). The routes used to be open to anyone, unthrottled, with no message
 * length cap, every call spending the merchant's own model key; and an
 * anonymous visitor's conversation was whoever presented its id.
 *
 * - `/api/ai-chat/message` is limited per visitor (AI_CHAT_MESSAGE_LIMITS)
 *   through the shared security runtime, refuses a message over
 *   AI_CHAT_MAX_MESSAGE_CHARS, and every model call it makes (rephrase,
 *   embedding, answer) counts against the site's one daily AI budget
 *   (AI_SITE_BUDGET_KEY), the same counter the workflow AI nodes use.
 * - An anonymous visitor is the owner of a random key in an httpOnly cookie
 *   the routes set; the `user_id` stored is a uuid derived one-way from it,
 *   and nothing in the request body can name another. On https the cookie is
 *   AI_CHAT_VISITOR_COOKIE_SECURE (`__Host-`: `Path=/`, `Secure`, no
 *   `Domain`), which a sibling site on the shared hosting domain cannot set;
 *   plain http (local development) uses AI_CHAT_VISITOR_COOKIE. Its value is
 *   `<key>.<HMAC(app secret, key)>`, so a value these routes did not issue is
 *   replaced, never adopted; without the app secret the chat refuses. A
 *   signed-in visitor (auth-protected chat) is the session user, as before.
 * - A conversation id is only ever used by its owner: a message to someone
 *   else's (or an unknown) conversation starts a new one, and reading,
 *   renaming or deleting someone else's is a 404.
 */
export const AI_CHAT_MAX_MESSAGE_CHARS = 4000
export const AI_CHAT_MESSAGE_LIMITS: ReadonlyArray<[number, number]> = [
  [20, 60],
  [200, 86400],
]
// The workflow AI nodes' own budget key and size: one counter for the site.
export const AI_SITE_BUDGET_KEY = AI_SITE_CALLS_KEY
export const AI_SITE_CALLS_PER_DAY = WORKFLOW_AI_SITE_CALLS_PER_DAY
export const AI_CHAT_VISITOR_COOKIE = '__tq_ai_chat'
export const AI_CHAT_VISITOR_COOKIE_SECURE = '__Host-tq_ai_chat'
/** Longest conversation title / username stored. */
export const AI_CHAT_MAX_LABEL_CHARS = 200
/** Per-visitor limit of the conversation read routes, `[limit, windowSeconds]`. */
export const AI_CHAT_READ_LIMIT: [number, number] = [120, 60]
const AI_CHAT_BUSY_MESSAGE = 'The assistant is unavailable right now. Please try again later.'

/** `var __security = require(...)` for a route whose folder is `rootPrefix` below the root. */
const securityRequire = (rootPrefix: string): string =>
  `var __security = require('${securityRuntimeSpecifier(rootPrefix)}');`

/**
 * A protected chat reads the visitor's session through the app's one session
 * reader (`__tqSessionToken`): the "__Host-" cookie on https and nothing else —
 * a cookie a sibling site on the shared parent domain planted is never a
 * session — and a session revoked by a password change is none either.
 * `getServerSession` would name the cookie after this instance's NEXTAUTH_URL.
 */
const sessionReaderCode = (
  chat: UIDLAIAssistantChat,
  rootPrefix: string,
  options: ChatRouteOptions
): string =>
  chat.authProtection?.requiresAuth
    ? `\n${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(rootPrefix, {
        withRevocation: options.withSessionRevocation !== false,
      })}`
    : ''

export interface ChatRouteOptions {
  /** The project has authentication: the session reader checks revocation. */
  withSessionRevocation?: boolean
}

/** The read routes' per-visitor limit; a refusal has answered 429. */
const readLimitCode = (): string =>
  `  if (!(await __security.rateLimitRequest(req, res, { scope: 'ai-chat-read', limit: ${AI_CHAT_READ_LIMIT[0]}, windowSeconds: ${AI_CHAT_READ_LIMIT[1]} }))) return;`

/** One `rateLimitRequest` per [limit, window] pair; a refusal has answered 429. */
const visitorLimitsCode = (scope: string): string =>
  AI_CHAT_MESSAGE_LIMITS.map(
    ([limit, windowSeconds]) =>
      `  if (!(await __security.rateLimitRequest(req, res, { scope: '${scope}', limit: ${limit}, windowSeconds: ${windowSeconds} }))) return;`
  ).join('\n')

/**
 * The anonymous visitor's id (nothing for an auth-protected chat, whose owner
 * is the session user, authUserId from the auth guard).
 */
function visitorIdCode(chat: UIDLAIAssistantChat): string {
  if (chat.authProtection?.requiresAuth) {
    return ''
  }
  return `
// The visitor's key lives in an httpOnly cookie these routes set, signed with
// the app secret; the stored user_id (a uuid column) is derived from the key
// one-way, so knowing someone's user_id or conversation id never lets anyone
// act as them. On https the cookie is __Host- (only this origin can set it);
// a value these routes did not issue is replaced, never adopted. null when
// the app has no secret to sign with: the chat then refuses.
function __aiChatVisitorId(req, res) {
  var crypto = require('crypto');
  var secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error('[ai-chat] NEXTAUTH_SECRET is not set: the visitor cookie cannot be signed');
    return null;
  }
  var sign = function(value) {
    return crypto.createHmac('sha256', secret).update('teleport-ai-chat-visitor:v1:' + value).digest('hex');
  };
  // https the way the site's session cookie reads it: the proxy's header, the
  // socket, else any host that is not a local one.
  var headers = req.headers || {};
  var proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  var host = String(headers.host || '').toLowerCase();
  var secure = proto
    ? proto === 'https'
    : !!(req.socket && req.socket.encrypted) ||
      (!!host && !/^(localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0)/.test(host));
  var name = secure ? '${AI_CHAT_VISITOR_COOKIE_SECURE}' : '${AI_CHAT_VISITOR_COOKIE}';
  var raw = String((req.headers && req.headers.cookie) || '');
  var key = '';
  var parts = raw.split(';');
  for (var i = 0; i < parts.length && !key; i++) {
    var eq = parts[i].indexOf('=');
    if (eq > 0 && parts[i].slice(0, eq).trim() === name) {
      var match = /^([0-9a-f]{32})\\.([0-9a-f]{64})$/.exec(parts[i].slice(eq + 1).trim());
      if (match && __security.safeEqual(match[2], sign(match[1]))) key = match[1];
    }
  }
  if (!key) {
    key = crypto.randomBytes(16).toString('hex');
    var existing = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
    var cookies = !existing ? [] : Array.isArray(existing) ? existing : [String(existing)];
    res.setHeader('Set-Cookie', cookies.concat([
      name + '=' + key + '.' + sign(key) +
        (secure ? '; Path=/; Secure' : '; Path=/api/ai-chat') + '; HttpOnly; SameSite=Lax; Max-Age=31536000',
    ]));
  }
  var h = crypto.createHash('sha256').update('teleport-ai-chat-visitor:' + key).digest('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
}
`
}

/** `__aiChatLabel(value)`: a stored title / username, capped, or null. */
const labelCode = (): string => `
function __aiChatLabel(value) {
  if (value == null || value === '') return null;
  return String(value).slice(0, ${AI_CHAT_MAX_LABEL_CHARS});
}
`

/** The request owner's id helper plus the conversation-ownership check. */
function ownershipCode(chat: UIDLAIAssistantChat): string {
  return `${visitorIdCode(chat)}
// Whether ownerId owns the conversation: its row's owner, or — for a
// conversation that only has messages — its first message's.
async function __aiChatOwns(conversationId, ownerId) {
  if (!conversationId || ownerId == null || ownerId === '') return false;
  var conversation = await db.selectOne(${JSON.stringify(
    chat.tables.conversationsTable
  )}, { id: conversationId });
  if (conversation) return String(conversation.user_id) === String(ownerId);
  var first = await db.selectOne(${JSON.stringify(
    chat.tables.messagesTable
  )}, { conversation_id: conversationId });
  return !!first && String(first.user_id) === String(ownerId);
}
`
}

/** The expression for the request's owner, after the auth guard. */
const ownerExpression = (chat: UIDLAIAssistantChat): string =>
  chat.authProtection?.requiresAuth ? 'authUserId' : '__aiChatVisitorId(req, res)'

function generateAuthGuardBlock(
  authProtection: NonNullable<UIDLAIAssistantChat['authProtection']>,
  userIdVar: string
): string {
  const allowedRoles = authProtection.allowedRoles || []
  const allowedRolesJson = JSON.stringify(allowedRoles)
  return `
  var authToken = await __tqSessionToken(req);
  if (!authToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  var ALLOWED_ROLES = ${allowedRolesJson};
  if (ALLOWED_ROLES.length > 0) {
    var userRole =
      typeof authToken.role === 'string'
        ? authToken.role
        : typeof authToken.roleName === 'string'
        ? authToken.roleName
        : Array.isArray(authToken.roles) && typeof authToken.roles[0] === 'string'
        ? authToken.roles[0]
        : null;
    if (!userRole || ALLOWED_ROLES.indexOf(userRole) < 0) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  var ${userIdVar} = authToken.id || authToken.email || String(authToken.sub || 'authenticated');
`
}

export function generateMessageRouteCode(
  chat: UIDLAIAssistantChat,
  options: ChatRouteOptions = {}
): string {
  const tables = chat.tables
  const ragConfig = chat.ragConfig
  const streaming = ragConfig.answer.streaming
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, 'authUserId')
    : ''
  // The id / user_id / conversation_id columns are uuid (the platform forces
  // every primary key to uuid), so every value written here MUST be a valid
  // uuid — otherwise Postgres rejects the insert with "invalid input syntax for
  // type uuid" and the whole chat 500s. An anonymous visitor's user_id is the
  // uuid derived from its cookie key; body.userId is never read.
  return `// POST /api/ai-chat/message — RAG pipeline entry point
var provider = require('../../../lib/ai-chat/provider');
var db = require('../../../lib/ai-chat/db');
${securityRequire('../../..')}${sessionReaderCode(chat, '../../..', options)}

var MAX_MESSAGE_CHARS = ${AI_CHAT_MAX_MESSAGE_CHARS};
var AI_BUSY = ${JSON.stringify(AI_CHAT_BUSY_MESSAGE)};

// One call to the model (a rephrase, an embedding, an answer) out of the
// site's daily AI budget, shared with the workflow AI nodes. false = spent.
async function __aiSiteBudget() {
  var budget = await __security.rateLimit({ key: '${AI_SITE_BUDGET_KEY}', limit: ${AI_SITE_CALLS_PER_DAY}, windowSeconds: 86400 });
  return budget.allowed;
}
${ownershipCode(chat)}
function _newId() {
  try { return require('crypto').randomUUID(); } catch (e) {}
  // Fallback uuid v4 (older runtimes without crypto.randomUUID).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateId() {
  return _newId();
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  var len = Math.min(a.length, b.length);
  var dot = 0, magA = 0, magB = 0;
  for (var i = 0; i < len; i++) {
    var va = a[i] || 0;
    var vb = b[i] || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function parseEmbedding(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
${visitorLimitsCode('ai-chat-message')}
${authGuard}

  try {
    var body = req.body || {};
    var userMessage = (typeof body.message === 'string' ? body.message : '').trim();
    if (!userMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (userMessage.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: 'Message is too long.' });
    }

    var userId = ${ownerExpression(chat)};
    if (!userId) {
      return res.status(503).json({ error: AI_BUSY });
    }
    var __uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var requestedConversationId = (typeof body.conversationId === 'string' && __uuidRe.test(body.conversationId)) ? body.conversationId : null;
    // Only the owner continues a conversation; anyone else starts a new one.
    var conversationId = requestedConversationId && (await __aiChatOwns(requestedConversationId, userId)) ? requestedConversationId : _newId();

    // The rephrase's share of the site's AI budget, taken before anything is stored.
    if (!(await __aiSiteBudget())) {
      return res.status(429).json({ error: AI_BUSY });
    }

    // Step 1: Store user message
    var userMsgId = generateId();
    var now = new Date().toISOString();
    await db.insert(${JSON.stringify(tables.messagesTable)}, {
      id: userMsgId,
      conversation_id: conversationId,
      user_id: userId,
      message: userMessage,
      role: 'user',
      message_type: 'user_question',
      covered_by_knowledge: true,
      created_at: now,
      updated_at: now,
    });

    // Step 2: Get conversation history
    var history = await db.selectMany(${JSON.stringify(tables.messagesTable)}, {
      where: { conversation_id: conversationId },
      whereIn: { column: 'role', values: ['user', 'assistant'] },
      orderBy: { column: 'created_at', direction: 'DESC' },
      limit: ${ragConfig.conversationHistoryLimit},
    });
    history = (history || []).reverse();

    // Step 3: Rephrase question using conversation history
    var rephrasedQuestion = userMessage;
    try {
      var historyStr = history.map(function(m) { return m.role + ': ' + m.message; }).join('\\n');
      var rephrasePrompt = 'Chat history:\\n' + historyStr + '\\n\\nUser input: "' + userMessage + '"\\n\\nStandalone version:';
      var rephraseResult = await provider.chatCompletion({
        systemMessage: ${JSON.stringify(ragConfig.rephrase.systemMessage)},
        userMessage: rephrasePrompt,
        temperature: ${ragConfig.rephrase.temperature},
        maxTokens: ${ragConfig.rephrase.maxTokens},
      });
      if (rephraseResult.content) {
        rephrasedQuestion = rephraseResult.content.trim() || userMessage;
      }
    } catch (_rephraseErr) {
      // If rephrasing fails, use original question
    }

    // Step 4: Fetch knowledge documents
    var documents = await db.selectMany(${JSON.stringify(tables.documentsTable)}, {
      columns: 'id, content, search_content, embedding_json',
      limit: 200,
    });
    documents = documents || [];

    // Step 5: Semantic search
    var contextChunks = [];
    if (documents.length > 0 && (await __aiSiteBudget())) {
      try {
        var queryEmbedding = await provider.generateEmbedding(rephrasedQuestion);
        var scored = [];
        for (var di = 0; di < documents.length; di++) {
          var doc = documents[di];
          var docEmbedding = parseEmbedding(doc.embedding_json);
          if (!docEmbedding) continue;
          var score = cosineSimilarity(queryEmbedding, docEmbedding);
          if (score > 0) {
            scored.push({ doc: doc, score: score });
          }
        }
        scored.sort(function(a, b) { return b.score - a.score; });
        var topResults = scored.slice(0, ${ragConfig.searchTopK});
        if (topResults.length > 0) {
          // Line breaks are kept: a knowledge chunk is often a record whose
          // "Field: value" layout is what tells the model it IS a record.
          contextChunks = topResults.map(function(r) {
            return String(r.doc.content || r.doc.search_content || '').trim();
          }).filter(function(text) { return text.length > 0; });
        }
      } catch (_embErr) {
        // If embedding fails, proceed without context
      }
    }

    // Step 6: Build prompt context
    var contextStr = contextChunks.join('\\n\\n---\\n\\n');

    // Step 7: AI answer
    var aiPrompt = contextStr
      ? 'Context:\\n"""\\n' + contextStr + '\\n"""\\n\\nQuestion: "' + rephrasedQuestion + '"'
      : 'Question: "' + rephrasedQuestion + '"';

    var aiMsgId = generateId();

    if (!(await __aiSiteBudget())) {
      return res.status(429).json({ error: AI_BUSY });
    }

    // \`covered_by_knowledge\` answers "could the knowledge base carry this
    // question?" — the column the merchant's admin Chat Messages list reads to
    // find the gaps. Setting it from "the search returned rows" made it a
    // constant true, because the search always returns its top-K. The finished
    // answer is the only honest signal, and matching the model's own configured
    // fallback sentence is exact.
    //
    // On a multilingual project the model answers in the visitor's language and
    // picks its refusal from the list the system prompt gives it, so EVERY
    // language's sentence has to be recognised here — matching only the main
    // one would record a translated refusal as a covered answer.
    var UNKNOWN_INFORMATION_MESSAGES = ${JSON.stringify(collectUnknownInformationMessages(chat))};
    function answeredFromKnowledge(answer) {
      var normalized = String(answer == null ? '' : answer).replace(/\\s+/g, ' ').trim().toLowerCase();
      if (!normalized) { return false; }
      for (var fi = 0; fi < UNKNOWN_INFORMATION_MESSAGES.length; fi++) {
        var fallback = String(UNKNOWN_INFORMATION_MESSAGES[fi]).replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!fallback) { continue; }
        if (normalized.indexOf(fallback) !== -1) { return false; }
      }
      return true;
    }
${
  streaming
    ? generateStreamingResponseBlock(tables, ragConfig)
    : generateNonStreamingResponseBlock(tables, ragConfig)
}

  } catch (err) {
    console.error('[ai-chat] Error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
`
}

function generateStreamingResponseBlock(
  tables: UIDLAIAssistantChat['tables'],
  ragConfig: UIDLAIAssistantChat['ragConfig']
): string {
  return `
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    var fullResponse = '';
    try {
      await provider.streamChatCompletion(
        {
          systemMessage: ${JSON.stringify(ragConfig.answer.systemMessage)},
          userMessage: aiPrompt,
          temperature: ${ragConfig.answer.temperature},
          maxTokens: ${ragConfig.answer.maxTokens},
        },
        async function onChunk(chunk, accumulated) {
          fullResponse = accumulated;
          res.write('data: ' + JSON.stringify({ type: 'chunk', chunk: chunk, fullResponse: accumulated }) + '\\n\\n');
        }
      );
    } catch (streamErr) {
      // The provider's message can carry account details; it stays in the log.
      console.error('[ai-chat] Stream error:', streamErr);
      fullResponse = fullResponse || 'Sorry, something went wrong. Please try again.';
      res.write('data: ' + JSON.stringify({ type: 'error', error: 'Stream error' }) + '\\n\\n');
    }

    // Step 8: Store assistant message
    var coveredByKnowledge = contextChunks.length > 0 && answeredFromKnowledge(fullResponse);
    var aiNow = new Date().toISOString();
    await db.insert(${JSON.stringify(tables.messagesTable)}, {
      id: aiMsgId,
      conversation_id: conversationId,
      user_id: userId,
      message: fullResponse,
      role: 'assistant',
      message_type: 'assistant_answer',
      covered_by_knowledge: coveredByKnowledge,
      created_at: aiNow,
      updated_at: aiNow,
    });

    // Update conversation metadata
    try {
      await db.update(${JSON.stringify(tables.conversationsTable)}, conversationId, {
        last_message_at: aiNow,
        updated_at: aiNow,
      });
    } catch (_) {}

    res.write('data: ' + JSON.stringify({
      type: 'done',
      id: aiMsgId,
      message: fullResponse,
      role: 'assistant',
      conversationId: conversationId,
      coveredByKnowledge: coveredByKnowledge,
    }) + '\\n\\n');
    res.end();`
}

function generateNonStreamingResponseBlock(
  tables: UIDLAIAssistantChat['tables'],
  ragConfig: UIDLAIAssistantChat['ragConfig']
): string {
  return `
    var answerResult = await provider.chatCompletion({
      systemMessage: ${JSON.stringify(ragConfig.answer.systemMessage)},
      userMessage: aiPrompt,
      temperature: ${ragConfig.answer.temperature},
      maxTokens: ${ragConfig.answer.maxTokens},
    });

    var aiResponse = (answerResult.content || '').trim();
    if (!aiResponse) {
      aiResponse = 'Sorry, I could not process your request.';
    }

    // Step 8: Store assistant message
    var coveredByKnowledge = contextChunks.length > 0 && answeredFromKnowledge(aiResponse);
    var aiNow = new Date().toISOString();
    await db.insert(${JSON.stringify(tables.messagesTable)}, {
      id: aiMsgId,
      conversation_id: conversationId,
      user_id: userId,
      message: aiResponse,
      role: 'assistant',
      message_type: 'assistant_answer',
      covered_by_knowledge: coveredByKnowledge,
      created_at: aiNow,
      updated_at: aiNow,
    });

    // Update conversation metadata
    try {
      await db.update(${JSON.stringify(tables.conversationsTable)}, conversationId, {
        last_message_at: aiNow,
        updated_at: aiNow,
      });
    } catch (_) {}

    return res.status(200).json({
      id: aiMsgId,
      message: aiResponse,
      role: 'assistant',
      conversationId: conversationId,
      coveredByKnowledge: coveredByKnowledge,
    });`
}

export function generateConversationsRouteCode(
  chat: UIDLAIAssistantChat,
  options: ChatRouteOptions = {}
): string {
  const tables = chat.tables
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, 'authUserId')
    : ''

  return `// GET  /api/ai-chat/conversations — list conversations
// POST /api/ai-chat/conversations — create a new conversation
var db = require('../../../../lib/ai-chat/db');
${securityRequire('../../../..')}${sessionReaderCode(chat, '../../../..', options)}
${visitorIdCode(chat)}${labelCode()}
// id / user_id columns are uuid — generate valid uuids, never 'conv_…' strings.
function _newId() {
  try { return require('crypto').randomUUID(); } catch (e) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateConvId() {
  return _newId();
}

export default async function handler(req, res) {
${authGuard ? authGuard.replace(/^\n/, '') + '\n' : ''}
  if (req.method === 'GET') {
${readLimitCode()}
    try {
      var userId = ${ownerExpression(chat)};
      var limit = parseInt(req.query.limit || '25', 10);
      var offset = parseInt(req.query.offset || '0', 10);
      if (limit < 1 || limit > 100) limit = 25;
      if (offset < 0) offset = 0;

      // No user id → nothing to list. Avoids 'WHERE user_id = '' ' which throws
      // on a uuid column.
      if (!userId) {
        return res.status(200).json({ conversations: [], limit: limit, offset: offset });
      }

      var rows = await db.selectMany(${JSON.stringify(tables.conversationsTable)}, {
        where: { user_id: userId },
        orderBy: { column: 'last_message_at', direction: 'DESC', nulls: 'LAST' },
        limit: limit,
        offset: offset,
      });
      return res.status(200).json({ conversations: rows || [], limit: limit, offset: offset });
    } catch (err) {
      console.error('[ai-chat] Error listing conversations:', err);
      return res.status(500).json({ error: 'Failed to list conversations' });
    }
  }

  if (req.method === 'POST') {
${visitorLimitsCode('ai-chat-conversation')}
    try {
      var body = req.body || {};
      var convId = generateConvId();
      var now = new Date().toISOString();
      var postUserId = ${ownerExpression(chat)};
      if (!postUserId) {
        return res.status(503).json({ error: 'Failed to create conversation' });
      }
      var row = await db.insert(${JSON.stringify(tables.conversationsTable)}, {
        id: convId,
        user_id: postUserId,
        username: __aiChatLabel(body.username),
        title: __aiChatLabel(body.title),
        status: 'active',
        message_count: 0,
        last_message_at: now,
        created_at: now,
        updated_at: now,
      });
      return res.status(201).json(row);
    } catch (err) {
      console.error('[ai-chat] Error creating conversation:', err);
      return res.status(500).json({ error: 'Failed to create conversation' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
`
}

export function generateConversationByIdRouteCode(
  chat: UIDLAIAssistantChat,
  options: ChatRouteOptions = {}
): string {
  const tables = chat.tables
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, 'authUserId')
    : ''
  return `// GET    /api/ai-chat/conversations/[id] — get conversation
// DELETE /api/ai-chat/conversations/[id] — delete conversation and messages
// PATCH  /api/ai-chat/conversations/[id] — update conversation status
var db = require('../../../../lib/ai-chat/db');
${securityRequire('../../../..')}${sessionReaderCode(chat, '../../../..', options)}
${ownershipCode(chat)}${labelCode()}
export default async function handler(req, res) {
${readLimitCode()}
${authGuard ? authGuard.replace(/^\n/, '') : ''}
  var id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: 'Conversation ID is required' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  // Someone else's conversation is answered exactly like a missing one.
  var ownerId = ${ownerExpression(chat)};

  if (req.method === 'GET') {
    try {
      var row = await db.selectOne(${JSON.stringify(tables.conversationsTable)}, { id: id });
      if (!row || String(row.user_id) !== String(ownerId)) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      return res.status(200).json(row);
    } catch (err) {
      console.error('[ai-chat] Error fetching conversation:', err);
      return res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      if (!(await __aiChatOwns(id, ownerId))) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      await db.removeWhere(${JSON.stringify(tables.messagesTable)}, { conversation_id: id });
      await db.remove(${JSON.stringify(tables.conversationsTable)}, id);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[ai-chat] Error deleting conversation:', err);
      return res.status(500).json({ error: 'Failed to delete conversation' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      var patchRow = await db.selectOne(${JSON.stringify(tables.conversationsTable)}, { id: id });
      if (!patchRow || String(patchRow.user_id) !== String(ownerId)) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      var body = req.body || {};
      var updates = { updated_at: new Date().toISOString() };
      if (body.status && ['active', 'resolved', 'escalated'].indexOf(body.status) >= 0) {
        updates.status = body.status;
      }
      if (body.title) {
        updates.title = __aiChatLabel(body.title);
      }
      var row = await db.update(${JSON.stringify(tables.conversationsTable)}, id, updates);
      return res.status(200).json(row);
    } catch (err) {
      console.error('[ai-chat] Error updating conversation:', err);
      return res.status(500).json({ error: 'Failed to update conversation' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
`
}

export function generateConversationMessagesRouteCode(
  chat: UIDLAIAssistantChat,
  options: ChatRouteOptions = {}
): string {
  const tables = chat.tables
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, 'authUserId')
    : ''

  return `// GET /api/ai-chat/conversations/[id]/messages — list messages for a conversation
var db = require('../../../../../lib/ai-chat/db');
${securityRequire('../../../../..')}${sessionReaderCode(chat, '../../../../..', options)}
${ownershipCode(chat)}
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
${readLimitCode()}
${authGuard}

  var id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: 'Conversation ID is required' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return res.status(200).json({ messages: [], limit: 0, offset: 0 });
  }

  try {
    if (!(await __aiChatOwns(id, ${ownerExpression(chat)}))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    var limit = parseInt(req.query.limit || '100', 10);
    var offset = parseInt(req.query.offset || '0', 10);
    if (limit < 1 || limit > 500) limit = 100;
    if (offset < 0) offset = 0;

    var rows = await db.selectMany(${JSON.stringify(tables.messagesTable)}, {
      where: { conversation_id: id },
      orderBy: { column: 'created_at', direction: 'ASC' },
      limit: limit,
      offset: offset,
    });
    return res.status(200).json({ messages: rows || [], limit: limit, offset: offset });
  } catch (err) {
    console.error('[ai-chat] Error fetching messages:', err);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
}
`
}
