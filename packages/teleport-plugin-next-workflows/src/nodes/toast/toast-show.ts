import { NodeHandlerGenerator } from '../types'

const TOAST_HANDLER_CODE = `async function toast_show(config) {
  var message = config.message || '';
  var toastType = config.toastType || 'info';
  var position = config.position || 'top-right';
  var duration = Number(config.duration) || 5000;
  var dismissible = config.dismissible !== false;

  var styleId = '__teleport-toast-styles';
  if (!document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '.__tp-toast-container { position: fixed; z-index: 99999; display: flex; flex-direction: column; gap: 8px; pointer-events: none; max-width: 400px; }',
      '.__tp-toast-container--top-right { top: 16px; right: 16px; }',
      '.__tp-toast-container--top-left { top: 16px; left: 16px; }',
      '.__tp-toast-container--top-center { top: 16px; left: 50%; transform: translateX(-50%); }',
      '.__tp-toast-container--bottom-right { bottom: 16px; right: 16px; }',
      '.__tp-toast-container--bottom-left { bottom: 16px; left: 16px; }',
      '.__tp-toast-container--bottom-center { bottom: 16px; left: 50%; transform: translateX(-50%); }',
      '.__tp-toast { pointer-events: auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.4; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transform: translateY(-8px); transition: opacity 0.3s ease, transform 0.3s ease; }',
      '.__tp-toast--visible { opacity: 1; transform: translateY(0); }',
      '.__tp-toast--info { background: #1e293b; }',
      '.__tp-toast--success { background: #16a34a; }',
      '.__tp-toast--error { background: #dc2626; }',
      '.__tp-toast--warning { background: #d97706; }',
      '.__tp-toast-icon { flex-shrink: 0; width: 18px; height: 18px; }',
      '.__tp-toast-msg { flex: 1; }',
      '.__tp-toast-close { flex-shrink: 0; background: none; border: none; color: inherit; cursor: pointer; opacity: 0.7; font-size: 18px; line-height: 1; padding: 0 0 0 8px; }',
      '.__tp-toast-close:hover { opacity: 1; }',
      '.__tp-toast--exit { opacity: 0; transform: translateY(-8px); }'
    ].join('\\n');
    document.head.appendChild(style);
  }

  var containerId = '__tp-toast-container--' + position;
  var container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = '__tp-toast-container __tp-toast-container--' + position;
    document.body.appendChild(container);
  }

  var icons = {
    info: '<svg class="__tp-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    success: '<svg class="__tp-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg class="__tp-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg class="__tp-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  var el = document.createElement('div');
  el.className = '__tp-toast __tp-toast--' + toastType;
  var iconHtml = icons[toastType] || icons.info;
  var closeHtml = dismissible ? '<button class="__tp-toast-close" aria-label="Close">&times;</button>' : '';
  el.innerHTML = iconHtml + '<span class="__tp-toast-msg">' + message.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' + closeHtml;

  container.appendChild(el);
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      el.classList.add('__tp-toast--visible');
    });
  });

  function removeToast() {
    el.classList.remove('__tp-toast--visible');
    el.classList.add('__tp-toast--exit');
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }

  if (dismissible) {
    var closeBtn = el.querySelector('.__tp-toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', removeToast);
    }
  }

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }

  return { success: true };
}`

export const toastShow: NodeHandlerGenerator = {
  nodeType: 'toast-show',
  executionEnv: 'client',
  generateHandler(): string {
    return TOAST_HANDLER_CODE
  },
}
