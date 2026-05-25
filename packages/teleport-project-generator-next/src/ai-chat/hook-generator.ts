import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'

export function generateHookCode(chat: UIDLAIAssistantChat): string {
  const streaming = chat.ragConfig.answer.streaming
  const welcomeMessage = chat.chatSettings.welcomeMessage || 'Hello! How can I help you?'

  return `import { useState, useRef, useCallback, useEffect } from 'react';

var WELCOME_MSG = ${JSON.stringify(welcomeMessage)};

function getOrCreateUserId() {
  if (typeof window === 'undefined') return 'anonymous';
  var key = '__ai_chat_uid';
  var stored = null;
  try { stored = localStorage.getItem(key); } catch (_) {}
  if (stored) return stored;
  var id = 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  try { localStorage.setItem(key, id); } catch (_) {}
  return id;
}

function getSessionConversationId() {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem('__ai_chat_conv_id') || null; } catch (_) { return null; }
}

function setSessionConversationId(id) {
  if (typeof window === 'undefined') return;
  try {
    if (id) { sessionStorage.setItem('__ai_chat_conv_id', id); }
    else { sessionStorage.removeItem('__ai_chat_conv_id'); }
  } catch (_) {}
}

export default function useAIChat() {
  var welcomeMsg = { id: 'welcome_msg', sender: 'ai', message: WELCOME_MSG, status: 'sent' };
  var [messages, setMessages] = useState([welcomeMsg]);
  var [inputValue, setInputValue] = useState('');
  var [isOpen, setIsOpen] = useState(false);
  var [isLoading, setIsLoading] = useState(false);
  var [conversationId, setConversationId] = useState(getSessionConversationId);
  var userIdRef = useRef(null);
  var messagesEndRef = useRef(null);

  useEffect(function() {
    userIdRef.current = getOrCreateUserId();
  }, []);

  useEffect(function() {
    setSessionConversationId(conversationId);
  }, [conversationId]);

  useEffect(function() {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  var sendMessage = useCallback(async function(content) {
    var trimmed = (content || '').trim();
    if (!trimmed || isLoading) return;

    var userMsg = {
      id: 'msg_' + Date.now(),
      sender: 'user',
      message: trimmed,
      status: 'sent',
    };
    var pendingMsg = {
      id: 'msg_' + (Date.now() + 1),
      sender: 'ai',
      message: '',
      status: 'pending',
    };

    setMessages(function(prev) { return prev.concat([userMsg, pendingMsg]); });
    setInputValue('');
    setIsLoading(true);

    try {
${streaming ? generateStreamingSendBlock() : generateNonStreamingSendBlock()}
    } catch (_err) {
      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.status === 'pending' || m.status === 'in_progress') {
            return Object.assign({}, m, { message: 'Sorry, something went wrong. Please try again.', status: 'error' });
          }
          return m;
        });
      });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, conversationId]);

  var toggleChat = useCallback(function() {
    setIsOpen(function(prev) { return !prev; });
  }, []);

  var closeChat = useCallback(function() {
    setIsOpen(false);
  }, []);

  var resetConversation = useCallback(function() {
    setConversationId(null);
    setMessages([welcomeMsg]);
    setInputValue('');
  }, []);

  var inputHasValue = inputValue.trim().length > 0;

  return {
    messages: messages,
    inputValue: inputValue,
    setInputValue: setInputValue,
    isOpen: isOpen,
    setIsOpen: setIsOpen,
    isLoading: isLoading,
    sendMessage: sendMessage,
    toggleChat: toggleChat,
    closeChat: closeChat,
    resetConversation: resetConversation,
    inputHasValue: inputHasValue,
    messagesEndRef: messagesEndRef,
    conversationId: conversationId,
  };
}
`
}

function generateStreamingSendBlock(): string {
  return `      var res = await fetch('/api/ai-chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversationId: conversationId,
          userId: userIdRef.current,
        }),
      });

      if (!res.ok) throw new Error('Failed to send message');

      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.status === 'pending' ? Object.assign({}, m, { status: 'in_progress' }) : m;
        });
      });

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var readResult = await reader.read();
        if (readResult.done) break;
        buffer += decoder.decode(readResult.value, { stream: true });

        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line.startsWith('data: ')) continue;
          var jsonStr = line.slice(6);
          var parsed;
          try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

          if (parsed.type === 'chunk') {
            setMessages(function(prev) {
              return prev.map(function(m) {
                return m.status === 'in_progress'
                  ? Object.assign({}, m, { message: parsed.fullResponse })
                  : m;
              });
            });
          } else if (parsed.type === 'done') {
            if (parsed.conversationId) setConversationId(parsed.conversationId);
            setMessages(function(prev) {
              return prev.map(function(m) {
                return m.status === 'in_progress'
                  ? Object.assign({}, m, { message: parsed.message || m.message, status: 'sent' })
                  : m;
              });
            });
          } else if (parsed.type === 'error') {
            setMessages(function(prev) {
              return prev.map(function(m) {
                return m.status === 'in_progress'
                  ? Object.assign({}, m, { message: 'Sorry, something went wrong. Please try again.', status: 'error' })
                  : m;
              });
            });
          }
        }
      }

      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.status === 'in_progress' ? Object.assign({}, m, { status: 'sent' }) : m;
        });
      });`
}

function generateNonStreamingSendBlock(): string {
  return `      var res = await fetch('/api/ai-chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversationId: conversationId,
          userId: userIdRef.current,
        }),
      });

      if (!res.ok) throw new Error('Failed to send message');

      var data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);

      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.status === 'pending'
            ? Object.assign({}, m, { message: data.message, status: 'sent' })
            : m;
        });
      });`
}
