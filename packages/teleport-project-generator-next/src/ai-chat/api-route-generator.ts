import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'
import { collectUnknownInformationMessages } from './localized-messages'

function generateAuthGuardBlock(
  authProtection: NonNullable<UIDLAIAssistantChat['authProtection']>,
  authOptionsPath: string,
  userIdVar: string
): string {
  const allowedRoles = authProtection.allowedRoles || []
  const allowedRolesJson = JSON.stringify(allowedRoles)
  return `
  try {
    var nextAuth = require('next-auth');
    var getServerSession = nextAuth.getServerSession || (nextAuth.default && nextAuth.default.getServerSession);
    var authOptions = require('${authOptionsPath}');
    var session = await getServerSession(req, res, authOptions);
    if (!session || !session.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    var ALLOWED_ROLES = ${allowedRolesJson};
    if (ALLOWED_ROLES.length > 0) {
      var userRole = session.user.role ?? session.user.roleName ?? (session.user.roles && session.user.roles[0]);
      if (userRole == null || typeof userRole !== 'string' || ALLOWED_ROLES.indexOf(userRole) < 0) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    var ${userIdVar} = session.user.id || session.user.email || String(session.user.sub || 'authenticated');
  } catch (authErr) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
`
}

export function generateMessageRouteCode(chat: UIDLAIAssistantChat): string {
  const tables = chat.tables
  const ragConfig = chat.ragConfig
  const streaming = ragConfig.answer.streaming
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, '../../../utils/auth/auth-options', 'authUserId')
    : ''
  // The id / user_id / conversation_id columns are uuid (the platform forces
  // every primary key to uuid), so every value written here MUST be a valid
  // uuid — otherwise Postgres rejects the insert with "invalid input syntax for
  // type uuid" and the whole chat 500s. body.userId now arrives as a uuid from
  // the widget; the fallback generates one so an inserted row is never invalid.
  const userIdSource = authProtection?.requiresAuth ? 'authUserId' : '(body.userId || _newId())'

  return `// POST /api/ai-chat/message — RAG pipeline entry point
var provider = require('../../../lib/ai-chat/provider');
var db = require('../../../lib/ai-chat/db');

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
${authGuard}

  try {
    var body = req.body || {};
    var userMessage = (body.message || '').trim();
    var __uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var conversationId = (body.conversationId && __uuidRe.test(body.conversationId)) ? body.conversationId : _newId();
    var userId = ${userIdSource};

    if (!userMessage) {
      return res.status(400).json({ error: 'Message is required' });
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
    if (documents.length > 0) {
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
      fullResponse = fullResponse || 'Sorry, something went wrong. Please try again.';
      res.write('data: ' + JSON.stringify({ type: 'error', error: streamErr.message || 'Stream error' }) + '\\n\\n');
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

export function generateConversationsRouteCode(chat: UIDLAIAssistantChat): string {
  const tables = chat.tables
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, '../../../../utils/auth/auth-options', 'authUserId')
    : ''

  return `// GET  /api/ai-chat/conversations — list conversations
// POST /api/ai-chat/conversations — create a new conversation
var db = require('../../../../lib/ai-chat/db');

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
    try {
      var userId = ${authProtection?.requiresAuth ? 'authUserId' : "req.query.userId || ''"};
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
    try {
      var body = req.body || {};
      var convId = generateConvId();
      var now = new Date().toISOString();
      var postUserId = ${authProtection?.requiresAuth ? 'authUserId' : 'body.userId || _newId()'};
      var row = await db.insert(${JSON.stringify(tables.conversationsTable)}, {
        id: convId,
        user_id: postUserId,
        username: body.username || null,
        title: body.title || null,
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

export function generateConversationByIdRouteCode(chat: UIDLAIAssistantChat): string {
  const tables = chat.tables
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(authProtection, '../../../../utils/auth/auth-options', 'authUserId')
    : ''
  const ownershipCheck = authProtection?.requiresAuth
    ? `
      if (row.user_id !== authUserId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }`
    : ''

  return `// GET    /api/ai-chat/conversations/[id] — get conversation
// DELETE /api/ai-chat/conversations/[id] — delete conversation and messages
// PATCH  /api/ai-chat/conversations/[id] — update conversation status
var db = require('../../../../lib/ai-chat/db');

export default async function handler(req, res) {
${authGuard ? authGuard.replace(/^\n/, '') : ''}
  var id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: 'Conversation ID is required' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (req.method === 'GET') {
    try {
      var row = await db.selectOne(${JSON.stringify(tables.conversationsTable)}, { id: id });
      if (!row) return res.status(404).json({ error: 'Conversation not found' });${ownershipCheck}
      return res.status(200).json(row);
    } catch (err) {
      console.error('[ai-chat] Error fetching conversation:', err);
      return res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      ${
        authProtection?.requiresAuth
          ? `var delRow = await db.selectOne(${JSON.stringify(
              tables.conversationsTable
            )}, { id: id });
      if (!delRow) return res.status(404).json({ error: 'Conversation not found' });
      if (delRow.user_id !== authUserId) return res.status(404).json({ error: 'Conversation not found' });
      `
          : ''
      }await db.removeWhere(${JSON.stringify(tables.messagesTable)}, { conversation_id: id });
      await db.remove(${JSON.stringify(tables.conversationsTable)}, id);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[ai-chat] Error deleting conversation:', err);
      return res.status(500).json({ error: 'Failed to delete conversation' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      ${
        authProtection?.requiresAuth
          ? `var patchRow = await db.selectOne(${JSON.stringify(
              tables.conversationsTable
            )}, { id: id });
      if (!patchRow) return res.status(404).json({ error: 'Conversation not found' });
      if (patchRow.user_id !== authUserId) return res.status(404).json({ error: 'Conversation not found' });
      `
          : ''
      }var body = req.body || {};
      var updates = { updated_at: new Date().toISOString() };
      if (body.status && ['active', 'resolved', 'escalated'].indexOf(body.status) >= 0) {
        updates.status = body.status;
      }
      if (body.title) {
        updates.title = body.title;
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

export function generateConversationMessagesRouteCode(chat: UIDLAIAssistantChat): string {
  const tables = chat.tables
  const authProtection = chat.authProtection
  const authGuard = authProtection?.requiresAuth
    ? generateAuthGuardBlock(
        authProtection,
        '../../../../../../utils/auth/auth-options',
        'authUserId'
      )
    : ''

  return `// GET /api/ai-chat/conversations/[id]/messages — list messages for a conversation
var db = require('../../../../../lib/ai-chat/db');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
${authGuard}

  var id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: 'Conversation ID is required' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return res.status(200).json({ messages: [], limit: 0, offset: 0 });
  }

  try {
    ${
      authProtection?.requiresAuth
        ? `var convRow = await db.selectOne(${JSON.stringify(
            chat.tables.conversationsTable
          )}, { id: id });
    if (!convRow) return res.status(404).json({ error: 'Conversation not found' });
    if (convRow.user_id !== authUserId) return res.status(404).json({ error: 'Conversation not found' });
    `
        : ''
    }var limit = parseInt(req.query.limit || '100', 10);
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
