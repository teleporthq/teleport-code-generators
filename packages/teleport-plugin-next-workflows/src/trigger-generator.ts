import { UIDLWorkflow } from '@teleporthq/teleport-types'

/**
 * For DOM events whose `target` is a form control (select, input, textarea,
 * checkbox/radio, file input), the user-visible value lives on `.value` /
 * `.checked` / `.files`. The workflow executor's `resolveContextRef`
 * resolves `Trigger.value` by reading `triggerContext.value`, so an
 * `event-element-event` handler that does NOT capture these fields turns
 * every `state-update-local-state` node bound to `[triggerNodeId, 'value']`
 * (the GUI's default for "set state to dropdown selection") into a no-op
 * — the dropdown/input change fires the workflow, but it writes `undefined`
 * to the state.
 *
 * Capturing these three fields unconditionally is safe: on non-form
 * elements they all evaluate to `undefined`, costing only a few extra
 * JS-object property writes per event.
 *
 * @param elementRef A JS expression that evaluates to the event target —
 *   typically `'__te'` (= `event.currentTarget || event.target`, used by
 *   the JSX-on-* handlers) or `'event.target'` (used by document-level
 *   `addEventListener` fallbacks).
 */
export const formControlPropertyReads = (elementRef: string): string =>
  `value: ${elementRef}.value, checked: ${elementRef}.checked, files: ${elementRef}.files`

export const generateTriggerCode = (workflow: UIDLWorkflow, workflowVarName: string): string => {
  const trigger = workflow.trigger
  const triggerType = trigger.type
  const config = trigger.config || {}

  const executionCall = generateExecutionCall(workflowVarName)

  switch (triggerType) {
    case 'event-element-clicked':
      return generateElementClickTrigger(config, executionCall, workflow.id)
    case 'event-element-visible':
      return generateElementVisibleTrigger(config, executionCall, workflow.id)
    case 'event-element-event':
      return generateElementEventTrigger(config, executionCall, workflow.id)
    case 'event-input-updated':
      return generateInputUpdatedTrigger(config, executionCall, workflow.id)
    case 'event-form-submitted':
      return generateFormSubmittedTrigger(config, executionCall, workflow.id)
    case 'event-page-loaded':
      return generatePageLoadedTrigger(config, executionCall, workflow.id)
    case 'event-user-logged-in':
      return generateCustomEventTrigger('workflow:user-logged-in', executionCall, workflow.id)
    case 'event-user-logged-out':
      return generateCustomEventTrigger('workflow:user-logged-out', executionCall, workflow.id)
    case 'event-unhandled-error':
      return generateUnhandledErrorTrigger(executionCall, workflow.id)
    case 'event-custom-triggered':
      return generateNamedCustomEventTrigger(config, executionCall, workflow.id)
    case 'event-data-item-added':
    case 'event-data-item-updated':
    case 'event-data-item-deleted':
      return generateDataEventTrigger(triggerType, config, executionCall, workflow.id)
    case 'realtime-on-channel-message':
    case 'realtime-on-channel-event':
    case 'realtime-on-user-joined-channel':
    case 'realtime-on-user-left-channel':
      return generateRealtimeTrigger(triggerType, config, executionCall, workflow.id)
    case 'event-key-pressed':
      return generateKeyPressedTrigger(config, executionCall, workflow.id)
    case 'event-key-released':
      return generateKeyReleasedTrigger(config, executionCall, workflow.id)
    case 'event-interval':
      return generateIntervalTrigger(config, executionCall, workflow.id)
    case 'event-window-resize':
      return generateWindowResizeTrigger(config, executionCall, workflow.id)
    case 'event-workflow-error':
      return ''
    case 'event-state-change':
    case 'event-global-state-change':
    case 'event-cron-triggered':
      return ''
    default:
      return `// Unknown trigger type: ${triggerType}`
  }
}

const generateExecutionCall = (workflowVarName: string): string => {
  return `${workflowVarName}(triggerContext)`
}

const generateElementClickTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const elementId = (config.elementHtmlId || config.nodeId) as string
  const eventType = (config.eventType as string) || 'click'
  const preventDefault = config.preventDefault as boolean
  const stopPropagation = config.stopPropagation as boolean
  const debounce = config.debounce as number | undefined

  let handlerBody = ''
  if (preventDefault) {
    handlerBody += '      event.preventDefault();\n'
  }
  if (stopPropagation) {
    handlerBody += '      event.stopPropagation();\n'
  }

  handlerBody += `      const triggerContext = {
        elementId: '${elementId}',
        timestamp: Date.now(),
        clientX: event.clientX,
        clientY: event.clientY
      };
      ${executionCall};`

  let code = `
    // Workflow trigger: element click (${workflowId})
    const el_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')} = document.getElementById('${elementId}');
    if (el_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')}) {
      const handler_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')} = function(event) {
${handlerBody}
      };`

  if (debounce) {
    code += `
      let _timer_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')} = null;
      const _wrapped_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')} = function(event) {
        clearTimeout(_timer_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')});
        _timer_${workflowId.replace(
          /[^a-zA-Z0-9]/g,
          '_'
        )} = setTimeout(function() { handler_${workflowId.replace(
      /[^a-zA-Z0-9]/g,
      '_'
    )}(event); }, ${debounce});
      };
      el_${workflowId.replace(
        /[^a-zA-Z0-9]/g,
        '_'
      )}.addEventListener('${eventType}', _wrapped_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')});
      return function() { el_${workflowId.replace(
        /[^a-zA-Z0-9]/g,
        '_'
      )}.removeEventListener('${eventType}', _wrapped_${workflowId.replace(
      /[^a-zA-Z0-9]/g,
      '_'
    )}); };`
  } else {
    code += `
      el_${workflowId.replace(
        /[^a-zA-Z0-9]/g,
        '_'
      )}.addEventListener('${eventType}', handler_${workflowId.replace(/[^a-zA-Z0-9]/g, '_')});
      return function() { el_${workflowId.replace(
        /[^a-zA-Z0-9]/g,
        '_'
      )}.removeEventListener('${eventType}', handler_${workflowId.replace(
      /[^a-zA-Z0-9]/g,
      '_'
    )}); };`
  }

  code += '\n    }'
  return code
}

const generateElementVisibleTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const elementId = (config.elementHtmlId || config.nodeId) as string
  const threshold = (config.threshold as number) || 0
  const once = config.once as boolean

  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')
  return `
    // Workflow trigger: element visible (${workflowId})
    const el_${safeId} = document.getElementById('${elementId}');
    if (el_${safeId}) {
      const obs_${safeId} = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            const triggerContext = {
              elementId: '${elementId}',
              timestamp: Date.now(),
              intersectionRatio: entry.intersectionRatio
            };
            ${executionCall};
            ${once ? `obs_${safeId}.disconnect();` : ''}
          }
        });
      }, { threshold: ${threshold} });
      obs_${safeId}.observe(el_${safeId});
      return function() { obs_${safeId}.disconnect(); };
    }`
}

const generateElementEventTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const elementId = (config.elementHtmlId || config.nodeId) as string
  const eventType = config.eventType as string
  const preventDefault = config.preventDefault as boolean
  const stopPropagation = config.stopPropagation as boolean
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  return `
    // Workflow trigger: element event (${workflowId})
    const el_${safeId} = document.getElementById('${elementId}');
    if (el_${safeId}) {
      const handler_${safeId} = function(event) {
        ${preventDefault ? 'event.preventDefault();' : ''}
        ${stopPropagation ? 'event.stopPropagation();' : ''}
        const triggerContext = { elementId: '${elementId}', eventType: '${eventType}', timestamp: Date.now(), target: event.target, clientX: event.clientX, clientY: event.clientY, offsetX: event.offsetX, offsetY: event.offsetY, button: event.button, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, key: event.key, ${formControlPropertyReads(
    'event.target'
  )} };
        ${
          eventType === 'drop'
            ? 'if (event.dataTransfer && event.dataTransfer.files) { triggerContext.files = Array.from(event.dataTransfer.files); }'
            : ''
        }
        ${executionCall};
      };
      el_${safeId}.addEventListener('${eventType}', handler_${safeId});
      return function() { el_${safeId}.removeEventListener('${eventType}', handler_${safeId}); };
    }`
}

const generateInputUpdatedTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const elementId = (config.elementHtmlId || config.nodeId) as string
  const debounce = config.debounce as number | undefined
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  let handler = `function(event) {
        const triggerContext = { value: event.target.value, previousValue: el_${safeId}._prevValue || '', elementId: '${elementId}', timestamp: Date.now() };
        el_${safeId}._prevValue = event.target.value;
        ${executionCall};
      }`

  if (debounce) {
    handler = `(function() {
        let timer = null;
        const orig = ${handler};
        return function(event) { clearTimeout(timer); timer = setTimeout(function() { orig(event); }, ${debounce}); };
      })()`
  }

  return `
    // Workflow trigger: input updated (${workflowId})
    const el_${safeId} = document.getElementById('${elementId}');
    if (el_${safeId}) {
      const handler_${safeId} = ${handler};
      el_${safeId}.addEventListener('input', handler_${safeId});
      return function() { el_${safeId}.removeEventListener('input', handler_${safeId}); };
    }`
}

const generateFormSubmittedTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const formId = (config.elementHtmlId || config.formNodeId) as string
  const preventDefault = config.preventDefault !== false
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  return `
    // Workflow trigger: form submitted (${workflowId})
    const form_${safeId} = document.getElementById('${formId}');
    if (form_${safeId}) {
      const handler_${safeId} = function(event) {
        ${preventDefault ? 'event.preventDefault();' : ''}
        const formData = {};
        const fd = new FormData(form_${safeId});
        fd.forEach(function(v, k) { formData[k] = v; });
        const triggerContext = { formData: formData, formId: '${formId}', timestamp: Date.now() };
        ${executionCall};
      };
      form_${safeId}.addEventListener('submit', handler_${safeId});
      return function() { form_${safeId}.removeEventListener('submit', handler_${safeId}); };
    }`
}

const generatePageLoadedTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const delay = config.delay as number | undefined
  return `
    // Workflow trigger: page loaded (${workflowId})
    {
      const triggerContext = { url: window.location.href, timestamp: Date.now(), referrer: document.referrer };
      ${delay ? `setTimeout(function() { ${executionCall}; }, ${delay});` : `${executionCall};`}
    }`
}

const generateCustomEventTrigger = (
  eventName: string,
  executionCall: string,
  workflowId: string
): string => {
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')
  return `
    // Workflow trigger: ${eventName} (${workflowId})
    const handler_${safeId} = function(event) {
      const triggerContext = event.detail || {};
      triggerContext.timestamp = Date.now();
      ${executionCall};
    };
    window.addEventListener('${eventName}', handler_${safeId});
    return function() { window.removeEventListener('${eventName}', handler_${safeId}); };`
}

const generateNamedCustomEventTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const eventName = config.eventName as string
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')
  return `
    // Workflow trigger: custom event '${eventName}' (${workflowId})
    const handler_${safeId} = function(event) {
      const triggerContext = { eventName: '${eventName}', eventData: event.detail, timestamp: Date.now() };
      ${executionCall};
    };
    window.addEventListener('workflow:custom:${eventName}', handler_${safeId});
    return function() { window.removeEventListener('workflow:custom:${eventName}', handler_${safeId}); };`
}

const generateUnhandledErrorTrigger = (executionCall: string, workflowId: string): string => {
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')
  return `
    // Workflow trigger: unhandled error (${workflowId})
    const handler_${safeId} = function(event) {
      const triggerContext = { message: event.message, stack: event.error ? event.error.stack : '', filename: event.filename, lineno: event.lineno, colno: event.colno };
      ${executionCall};
    };
    window.addEventListener('error', handler_${safeId});
    return function() { window.removeEventListener('error', handler_${safeId}); };`
}

const generateDataEventTrigger = (
  triggerType: string,
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')
  const eventName = `workflow:data:${triggerType.replace('event-data-item-', '')}`
  return `
    // Workflow trigger: ${triggerType} (${workflowId})
    const handler_${safeId} = function(event) {
      if (event.detail && event.detail.dataSourceId === '${config.dataSourceId}' && event.detail.tableName === '${config.tableName}') {
        const triggerContext = event.detail;
        triggerContext.timestamp = Date.now();
        ${executionCall};
      }
    };
    window.addEventListener('${eventName}', handler_${safeId});
    return function() { window.removeEventListener('${eventName}', handler_${safeId}); };`
}

const generateRealtimeTrigger = (
  triggerType: string,
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')
  const channelName = config.channelName as string
  const eventName = config.eventName as string | undefined

  switch (triggerType) {
    case 'realtime-on-channel-message':
      return generateRealtimeMessageTrigger(channelName, executionCall, safeId, workflowId)
    case 'realtime-on-channel-event':
      return generateRealtimeCustomEventTrigger(
        channelName,
        eventName || '',
        executionCall,
        safeId,
        workflowId
      )
    case 'realtime-on-user-joined-channel':
      return generateRealtimePresenceTrigger(
        'enter',
        channelName,
        executionCall,
        safeId,
        workflowId
      )
    case 'realtime-on-user-left-channel':
      return generateRealtimePresenceTrigger(
        'leave',
        channelName,
        executionCall,
        safeId,
        workflowId
      )
    default:
      return `// Unknown realtime trigger type: ${triggerType}`
  }
}

const wrapRealtimeSubscription = (
  channelName: string,
  subscribeCode: string,
  unsubscribeCode: string,
  safeId: string,
  workflowId: string,
  triggerType: string
): string => {
  return `
    // Workflow trigger: ${triggerType} (${workflowId})
    let __rtActive_${safeId} = true;
    let __rtCleanup_${safeId} = null;
    const __rt_${safeId} = typeof window !== 'undefined' ? window.__teleportRealtime : null;
    if (__rt_${safeId}) {
      const __rtClient_${safeId} = __rt_${safeId}.getAblyClient();
      if (__rtClient_${safeId}) {
        __rt_${safeId}.whenReady().then(function() {
          if (!__rtActive_${safeId}) return;
          const nsChannel = __rt_${safeId}.getNamespacedChannelName('${channelName}');
          const channel = __rtClient_${safeId}.channels.get(nsChannel);
          __rt_${safeId}.incrementChannelRef(nsChannel);
${subscribeCode}
          __rtCleanup_${safeId} = function() {
${unsubscribeCode}
            __rt_${safeId}.decrementChannelRef(nsChannel);
          };
        });
      }
    }
    cleanups.push(function() {
      __rtActive_${safeId} = false;
      if (__rtCleanup_${safeId}) __rtCleanup_${safeId}();
    });`
}

const generateRealtimeMessageTrigger = (
  channelName: string,
  executionCall: string,
  safeId: string,
  workflowId: string
): string => {
  const subscribeCode = `
          const msgHandler_${safeId} = function(message) {
            if (message.name !== 'message') return;
            const d = message.data || {};
            const triggerContext = {
              channelName: d.channelName || '${channelName}',
              message: d.message || '',
              messageData: d.messageData || null,
              senderId: d.senderId || '',
              senderName: d.senderName || '',
              messageId: d.messageId || '',
              timestamp: d.timestamp || Date.now()
            };
            ${executionCall};
          };
          channel.subscribe('message', msgHandler_${safeId});`
  const unsubscribeCode = `            channel.unsubscribe('message', msgHandler_${safeId});`

  return wrapRealtimeSubscription(
    channelName,
    subscribeCode,
    unsubscribeCode,
    safeId,
    workflowId,
    'realtime-on-channel-message'
  )
}

const generateRealtimeCustomEventTrigger = (
  channelName: string,
  eventName: string,
  executionCall: string,
  safeId: string,
  workflowId: string
): string => {
  const ablyEventName = `event:${eventName}`
  const subscribeCode = `
          const evtHandler_${safeId} = function(message) {
            const d = message.data || {};
            const triggerContext = {
              channelName: d.channelName || '${channelName}',
              eventName: d.eventName || '${eventName}',
              eventData: d.eventData || null,
              senderId: d.senderId || '',
              senderName: d.senderName || '',
              timestamp: d.timestamp || Date.now()
            };
            ${executionCall};
          };
          channel.subscribe('${ablyEventName}', evtHandler_${safeId});`
  const unsubscribeCode = `            channel.unsubscribe('${ablyEventName}', evtHandler_${safeId});`

  return wrapRealtimeSubscription(
    channelName,
    subscribeCode,
    unsubscribeCode,
    safeId,
    workflowId,
    'realtime-on-channel-event'
  )
}

const generateRealtimePresenceTrigger = (
  action: 'enter' | 'leave',
  channelName: string,
  executionCall: string,
  safeId: string,
  workflowId: string
): string => {
  const triggerType =
    action === 'enter' ? 'realtime-on-user-joined-channel' : 'realtime-on-user-left-channel'
  const subscribeCode = `
          const presHandler_${safeId} = function(presenceMessage) {
            const pd = presenceMessage.data || {};
            const triggerContext = {
              channelName: '${channelName}',
              userId: pd.userId || presenceMessage.clientId || '',
              userName: pd.userName || '',
              userData: pd.userData || null,
              timestamp: presenceMessage.timestamp || Date.now()
            };
            ${executionCall};
          };
          channel.presence.subscribe('${action}', presHandler_${safeId});`
  const unsubscribeCode = `            channel.presence.unsubscribe('${action}', presHandler_${safeId});`

  return wrapRealtimeSubscription(
    channelName,
    subscribeCode,
    unsubscribeCode,
    safeId,
    workflowId,
    triggerType
  )
}

const generateKeyPressedTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const key = config.key as string
  const preventDefault = config.preventDefault as boolean
  const ignoreRepeat = config.ignoreRepeat as boolean
  const elementHtmlId = config.elementHtmlId as string | undefined
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  return `
    // Workflow trigger: key pressed '${key}' (${workflowId})
    const __kpHandler_${safeId} = function(event) {
      if (event.key !== '${key}') return;
      ${ignoreRepeat ? 'if (event.repeat) return;' : ''}
      ${preventDefault ? 'event.preventDefault();' : ''}
      const triggerContext = {
        key: event.key, code: event.code, repeat: event.repeat,
        shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
        timestamp: Date.now()
      };
      ${executionCall};
    };
    const __kpTarget_${safeId} = ${
    elementHtmlId ? `document.getElementById('${elementHtmlId}')` : 'document'
  };
    if (__kpTarget_${safeId}) {
      __kpTarget_${safeId}.addEventListener('keydown', __kpHandler_${safeId});
      return function() { __kpTarget_${safeId}.removeEventListener('keydown', __kpHandler_${safeId}); };
    }`
}

const generateKeyReleasedTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const key = config.key as string
  const elementHtmlId = config.elementHtmlId as string | undefined
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  return `
    // Workflow trigger: key released '${key}' (${workflowId})
    const __krHandler_${safeId} = function(event) {
      if (event.key !== '${key}') return;
      const triggerContext = {
        key: event.key, code: event.code,
        shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
        timestamp: Date.now()
      };
      ${executionCall};
    };
    const __krTarget_${safeId} = ${
    elementHtmlId ? `document.getElementById('${elementHtmlId}')` : 'document'
  };
    if (__krTarget_${safeId}) {
      __krTarget_${safeId}.addEventListener('keyup', __krHandler_${safeId});
      return function() { __krTarget_${safeId}.removeEventListener('keyup', __krHandler_${safeId}); };
    }`
}

const generateIntervalTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const intervalMs = config.intervalMs as number
  const autoStart = config.autoStart !== false
  const controlEventName = config.controlEventName as string | undefined
  const maxTicks = config.maxTicks as number | undefined
  const runWhileHidden = config.runWhileHidden as boolean
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  return `
    // Workflow trigger: interval ${intervalMs}ms (${workflowId})
    var __iv_tickNum_${safeId} = 0;
    var __iv_startTime_${safeId} = 0;
    var __iv_lastTick_${safeId} = 0;
    var __iv_id_${safeId} = null;
    var __iv_running_${safeId} = false;
    var __iv_destroyed_${safeId} = false;

    function __iv_tick_${safeId}() {
      __iv_tickNum_${safeId}++;
      var now = Date.now();
      var triggerContext = {
        tickNumber: __iv_tickNum_${safeId},
        deltaTime: __iv_lastTick_${safeId} ? now - __iv_lastTick_${safeId} : ${intervalMs},
        elapsedTime: now - __iv_startTime_${safeId},
        timestamp: now,
        isFirstTick: __iv_tickNum_${safeId} === 1
      };
      __iv_lastTick_${safeId} = now;
      ${
        maxTicks && maxTicks > 0
          ? `if (__iv_tickNum_${safeId} >= ${maxTicks}) { __iv_stop_${safeId}(); }`
          : ''
      }
      ${executionCall};
    }

    function __iv_start_${safeId}() {
      if (__iv_id_${safeId} || __iv_destroyed_${safeId}) return;
      if (__iv_startTime_${safeId} === 0) {
        __iv_startTime_${safeId} = Date.now();
        __iv_lastTick_${safeId} = __iv_startTime_${safeId};
        __iv_tickNum_${safeId} = 0;
      }
      __iv_id_${safeId} = setInterval(__iv_tick_${safeId}, ${intervalMs});
      __iv_running_${safeId} = true;
    }

    function __iv_stop_${safeId}() {
      if (__iv_id_${safeId}) clearInterval(__iv_id_${safeId});
      __iv_id_${safeId} = null;
      __iv_running_${safeId} = false;
    }

    ${
      !runWhileHidden
        ? `
    var __iv_wasRunning_${safeId} = false;
    var __iv_visHandler_${safeId} = function() {
      if (__iv_destroyed_${safeId}) return;
      if (document.hidden) {
        __iv_wasRunning_${safeId} = __iv_running_${safeId};
        if (__iv_running_${safeId}) __iv_stop_${safeId}();
      } else if (__iv_wasRunning_${safeId}) {
        __iv_start_${safeId}();
        __iv_wasRunning_${safeId} = false;
      }
    };
    document.addEventListener('visibilitychange', __iv_visHandler_${safeId});`
        : ''
    }

    ${
      controlEventName
        ? `
    var __iv_ctrlHandler_${safeId} = function() {
      if (__iv_running_${safeId}) { __iv_stop_${safeId}(); }
      else { __iv_start_${safeId}(); }
    };
    window.addEventListener('${controlEventName}', __iv_ctrlHandler_${safeId});`
        : ''
    }

    ${autoStart ? `__iv_start_${safeId}();` : ''}

    return function() {
      __iv_destroyed_${safeId} = true;
      __iv_stop_${safeId}();
      ${
        !runWhileHidden
          ? `document.removeEventListener('visibilitychange', __iv_visHandler_${safeId});`
          : ''
      }
      ${
        controlEventName
          ? `window.removeEventListener('${controlEventName}', __iv_ctrlHandler_${safeId});`
          : ''
      }
    };`
}

const generateWindowResizeTrigger = (
  config: Record<string, unknown>,
  executionCall: string,
  workflowId: string
): string => {
  const minWidth = config.minWidth as number | null | undefined
  const maxWidth = config.maxWidth as number | null | undefined
  const minHeight = config.minHeight as number | null | undefined
  const maxHeight = config.maxHeight as number | null | undefined
  const debounceMs = (config.debounceMs as number) || 150
  const safeId = workflowId.replace(/[^a-zA-Z0-9]/g, '_')

  const hasThresholds =
    minWidth != null || maxWidth != null || minHeight != null || maxHeight != null

  const meetsConditions = [
    minWidth != null ? `w >= ${minWidth}` : null,
    maxWidth != null ? `w <= ${maxWidth}` : null,
    minHeight != null ? `h >= ${minHeight}` : null,
    maxHeight != null ? `h <= ${maxHeight}` : null,
  ].filter(Boolean)

  const prevMeetsConditions = [
    minWidth != null ? `pw >= ${minWidth}` : null,
    maxWidth != null ? `pw <= ${maxWidth}` : null,
    minHeight != null ? `ph >= ${minHeight}` : null,
    maxHeight != null ? `ph <= ${maxHeight}` : null,
  ].filter(Boolean)

  return `
    // Workflow trigger: window resize (${workflowId})
    var __wr_prevW_${safeId} = window.innerWidth;
    var __wr_prevH_${safeId} = window.innerHeight;
    var __wr_timer_${safeId} = null;
    var __wr_handler_${safeId} = function() {
      clearTimeout(__wr_timer_${safeId});
      __wr_timer_${safeId} = setTimeout(function() {
        var w = window.innerWidth;
        var h = window.innerHeight;
        var pw = __wr_prevW_${safeId};
        var ph = __wr_prevH_${safeId};
        ${
          hasThresholds
            ? `var meets = ${meetsConditions.join(' && ')};\n` +
              `        var prevMet = ${prevMeetsConditions.join(' && ')};\n` +
              `        var crossedBreakpoint = meets !== prevMet;\n` +
              `        if (meets) {\n` +
              `          var triggerContext = { width: w, height: h, previousWidth: pw, previousHeight: ph, crossedBreakpoint: crossedBreakpoint, timestamp: Date.now() };\n` +
              `          ${executionCall};\n` +
              `        }`
            : `var triggerContext = { width: w, height: h, previousWidth: pw, previousHeight: ph, crossedBreakpoint: false, timestamp: Date.now() };\n` +
              `        ${executionCall};`
        }
        __wr_prevW_${safeId} = w;
        __wr_prevH_${safeId} = h;
      }, ${debounceMs});
    };
    window.addEventListener('resize', __wr_handler_${safeId});
    return function() {
      window.removeEventListener('resize', __wr_handler_${safeId});
      clearTimeout(__wr_timer_${safeId});
    };`
}
