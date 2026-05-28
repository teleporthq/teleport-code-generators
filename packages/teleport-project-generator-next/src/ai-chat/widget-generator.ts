import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'

function styleObjToString(styles: Record<string, string>): string {
  return JSON.stringify(styles)
}

function positionStyles(position: string): Record<string, string> {
  switch (position) {
    case 'bottom-left':
      return { position: 'fixed', bottom: '24px', left: '24px', zIndex: '9999' }
    case 'top-right':
      return { position: 'fixed', top: '24px', right: '24px', zIndex: '9999' }
    case 'top-left':
      return { position: 'fixed', top: '24px', left: '24px', zIndex: '9999' }
    default:
      return { position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999' }
  }
}

function windowPositionStyles(position: string): Record<string, string> {
  const base: Record<string, string> = {
    position: 'fixed',
    width: '380px',
    maxWidth: 'calc(100vw - 32px)',
    height: '520px',
    maxHeight: 'calc(100vh - 120px)',
    zIndex: '9998',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }
  switch (position) {
    case 'bottom-left':
      return { ...base, bottom: '96px', left: '24px' }
    case 'top-right':
      return { ...base, top: '96px', right: '24px' }
    case 'top-left':
      return { ...base, top: '96px', left: '24px' }
    default:
      return { ...base, bottom: '96px', right: '24px' }
  }
}

export function generateWidgetCode(chat: UIDLAIAssistantChat): string {
  const settings = chat.chatSettings
  const pos = settings.bubblePosition || 'bottom-right'
  const bubblePos = positionStyles(pos)
  const windowPos = windowPositionStyles(pos)

  const needsUseEffect = !!settings.custom?.scripts
  return `${
    needsUseEffect ? "import { useEffect } from 'react';\n" : ''
  }import useAIChat from '../../hooks/useAIChat';
import AIChatBubble from './AIChatBubble';
import AIChatWindow from './AIChatWindow';

var BUBBLE_POSITION_STYLES = ${styleObjToString(bubblePos)};
var BUBBLE_CUSTOM_STYLES = ${styleObjToString(settings.bubbleStyles || {})};
var WINDOW_POSITION_STYLES = ${styleObjToString(windowPos)};
var WINDOW_CUSTOM_STYLES = ${styleObjToString(settings.window?.windowStyles || {})};
var CHAT_NAME = ${JSON.stringify(settings.chatName || 'AI Assistant')};

${settings.custom?.styles ? `var CUSTOM_STYLES = ${JSON.stringify(settings.custom.styles)};` : ''}

export default function AIChatWidget() {
  var chat = useAIChat();
${
  settings.custom?.scripts
    ? `
  useEffect(function() {
    try { (new Function(${JSON.stringify(settings.custom.scripts)}))(); } catch(_e) {}
  }, []);
`
    : ''
}

  return (
    <>
${
  settings.custom?.styles
    ? `      <style dangerouslySetInnerHTML={{ __html: CUSTOM_STYLES }} />`
    : ''
}
      <AIChatBubble
        isOpen={chat.isOpen}
        onClick={chat.toggleChat}
        style={Object.assign({}, BUBBLE_POSITION_STYLES, BUBBLE_CUSTOM_STYLES)}
      />
      {chat.isOpen && (
        <AIChatWindow
          chatName={CHAT_NAME}
          messages={chat.messages}
          inputValue={chat.inputValue}
          onInputChange={chat.setInputValue}
          onSend={chat.sendMessage}
          onClose={chat.closeChat}
          isLoading={chat.isLoading}
          inputHasValue={chat.inputHasValue}
          messagesEndRef={chat.messagesEndRef}
          windowStyle={Object.assign({}, WINDOW_POSITION_STYLES, WINDOW_CUSTOM_STYLES)}
        />
      )}
    </>
  );
}
`
}

export function generateBubbleCode(_chat: UIDLAIAssistantChat): string {
  return `import React from 'react';

var defaultChatIcon = React.createElement('svg', { width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
);

var defaultCloseIcon = React.createElement('svg', { width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
  React.createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
);

var baseStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  cursor: 'pointer',
  color: '#ffffff',
  transition: 'transform 0.2s ease',
  padding: '0',
};

export default function AIChatBubble(props) {
  var isOpen = props.isOpen;
  var onClick = props.onClick;
  var style = props.style;

  return React.createElement('button', {
    onClick: onClick,
    style: Object.assign({}, baseStyle, style),
    'aria-label': isOpen ? 'Close chat' : 'Open chat',
    className: 'ai-chat-bubble',
  }, isOpen ? defaultCloseIcon : defaultChatIcon);
}
`
}

export function generateWindowCode(chat: UIDLAIAssistantChat): string {
  const settings = chat.chatSettings
  const w = settings.window || ({} as UIDLAIAssistantChat['chatSettings']['window'])

  return `import React from 'react';
import AIChatMessage from './AIChatMessage';

var headerStyles = Object.assign({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  flexShrink: 0,
}, ${styleObjToString(w.headerStyles || {})});

var messagesContainerStyles = Object.assign({
  flex: '1',
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}, ${styleObjToString(w.messagesContainerStyles || {})});

var inputContainerStyles = Object.assign({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexShrink: 0,
  padding: '12px',
}, ${styleObjToString(w.inputContainerStyles || {})});

var inputStyles = Object.assign({
  flex: '1',
  border: 'none',
  outline: 'none',
  fontFamily: 'inherit',
}, ${styleObjToString(w.inputStyles || {})});

var sendBtnStyles = Object.assign({
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
}, ${styleObjToString(w.sendButtonStyles || {})});

var sendBtnDisabledStyles = Object.assign({}, sendBtnStyles, { opacity: 0.5, cursor: 'default' });

var closeIconSvg = React.createElement('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
  React.createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
);

var sendIconSvg = React.createElement('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'currentColor' },
  React.createElement('path', { d: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z' })
);

export default function AIChatWindow(props) {
  var chatName = props.chatName;
  var messages = props.messages;
  var inputValue = props.inputValue;
  var onInputChange = props.onInputChange;
  var onSend = props.onSend;
  var onClose = props.onClose;
  var isLoading = props.isLoading;
  var inputHasValue = props.inputHasValue;
  var messagesEndRef = props.messagesEndRef;
  var windowStyle = props.windowStyle;

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && inputHasValue) {
      e.preventDefault();
      onSend(inputValue);
    }
  }

  function handleSend() {
    if (inputHasValue) onSend(inputValue);
  }

  return React.createElement('div', {
    style: windowStyle,
    className: 'ai-chat-window',
    role: 'dialog',
    'aria-label': 'Chat window',
  },
    React.createElement('div', { style: headerStyles },
      React.createElement('span', { style: { fontWeight: '600', fontSize: '15px' } }, chatName),
      React.createElement('button', {
        onClick: onClose,
        style: { background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '4px', display: 'flex' },
        'aria-label': 'Close chat',
      }, closeIconSvg)
    ),
    React.createElement('div', { style: messagesContainerStyles, className: 'ai-chat-messages' },
      messages.map(function(msg) {
        return React.createElement(AIChatMessage, { key: msg.id, message: msg });
      }),
      React.createElement('div', { ref: messagesEndRef })
    ),
    React.createElement('div', { style: inputContainerStyles },
      React.createElement('input', {
        type: 'text',
        value: inputValue,
        onChange: function(e) { onInputChange(e.target.value); },
        onKeyDown: handleKeyDown,
        placeholder: 'Type a message...',
        style: inputStyles,
        disabled: isLoading,
        'aria-label': 'Message input',
      }),
      React.createElement('button', {
        onClick: handleSend,
        disabled: !inputHasValue || isLoading,
        style: inputHasValue && !isLoading ? sendBtnStyles : sendBtnDisabledStyles,
        'aria-label': 'Send message',
      }, sendIconSvg)
    )
  );
}
`
}

export function generateMessageCode(chat: UIDLAIAssistantChat): string {
  const settings = chat.chatSettings
  const w = settings.window || ({} as UIDLAIAssistantChat['chatSettings']['window'])

  return `import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

var botMsgStyles = Object.assign({
  maxWidth: '85%',
  alignSelf: 'flex-start',
  wordBreak: 'break-word',
}, ${styleObjToString(w.botMessageStyles || {})});

var userMsgStyles = Object.assign({
  maxWidth: '85%',
  alignSelf: 'flex-end',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
}, ${styleObjToString(w.userMessageStyles || {})});

var welcomeMsgStyles = Object.assign({}, botMsgStyles, ${styleObjToString(
    w.welcomeMessageStyles || {}
  )});

var typingDots = React.createElement('span', {
  style: { display: 'inline-flex', gap: '4px', alignItems: 'center', height: '20px' },
}, '...');

var remarkPlugins = [remarkGfm];

export default function AIChatMessage(props) {
  var msg = props.message;
  var isUser = msg.sender === 'user';
  var isWelcome = msg.id === 'welcome_msg';
  var isPending = msg.status === 'pending';
  var isError = msg.status === 'error';

  var style = isWelcome ? welcomeMsgStyles : isUser ? userMsgStyles : botMsgStyles;
  if (isError) {
    style = Object.assign({}, style, { opacity: 0.7 });
  }

  var content;
  if (isPending) {
    content = typingDots;
  } else if (!isUser && msg.message) {
    content = React.createElement(ReactMarkdown, { remarkPlugins: remarkPlugins }, msg.message);
  } else {
    content = msg.message || '';
  }

  return React.createElement('div', {
    style: style,
    className: isUser ? 'ai-chat-msg-user' : 'ai-chat-msg-bot',
  }, content);
}
`
}

export function generateGlobalCSSCode(): string {
  return `/* AI Chat Widget responsive + animation styles */
@media (max-width: 639px) {
  .ai-chat-window {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    border-radius: 0 !important;
  }
  .ai-chat-bubble {
    width: 48px !important;
    height: 48px !important;
  }
}

.ai-chat-messages::-webkit-scrollbar {
  width: 6px;
}
.ai-chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
.ai-chat-messages::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 3px;
}

@keyframes ai-chat-fade-in {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.ai-chat-window {
  animation: ai-chat-fade-in 300ms ease-out;
}
`
}
