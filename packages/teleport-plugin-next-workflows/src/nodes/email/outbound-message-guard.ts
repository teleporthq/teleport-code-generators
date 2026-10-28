import {
  UIDLWorkflowEdge,
  UIDLWorkflowNode,
  UIDLWorkflowProtection,
} from '@teleporthq/teleport-types'
import type { SegmentTrust } from '../../segment-trust'
import type { WorkflowSegment } from '../../types'
import { handlerToString, HandlerFn, NodeHandlerGenerator, ServerHandlerOptions } from '../types'
import {
  generateSecurityRuntimeVar,
  isOutboundMessageNodeType,
  serverHandlerPrefix,
  VISITOR_KEY_CODE,
} from '../general/visitor-request'
import { collectMessageTrust, MessageTrust, stepNameOf } from './message-trust'
import { escapeHtmlValueJs } from './html-escape-code'

/**
 * Email and SMS nodes on a route a visitor can call.
 *
 * - Header fields (addresses, subject) never carry a line break.
 * - A recipient the request can choose — anything but an author literal, the
 *   signed-in user's own value read from the session, or a read of the owner's
 *   settings (see message-trust) — is allowed (an auto-reply, a guest
 *   confirmation), but every such send is counted per visitor, per recipient
 *   and per site. A send over a limit is skipped and logged; the visitor's
 *   action goes on.
 * - Such a send's body must be the author's template: a body that is only
 *   values (one value, or markup around values with no author text; an SMS:
 *   its whole message) is refused at generation time, with the reason in the
 *   build log. So is a sender (address, name, SMS sender) the request can
 *   choose. A refused step never sends.
 * - Every value is escaped where the template is filled (`applyTemplateParams`
 *   and the rich-text placeholders in the runtime utils, `fillTemplate` for the
 *   account routes); a whole-value body is escaped by the guard. Only the
 *   platform's own HTML builders' output is sent as HTML.
 */

/** Sends to visitor-supplied recipients each visitor may make in an hour. */
export const VISITOR_SENDS_PER_IP_PER_HOUR = 5
/** Sends one visitor-supplied recipient may receive in an hour. */
export const VISITOR_SENDS_PER_RECIPIENT_PER_HOUR = 3
/** Sends to visitor-supplied recipients the whole site may make in a day, per channel. */
export const VISITOR_SENDS_PER_SITE_PER_DAY = 500

/** What a skipped or refused send answers. */
export const TOO_MANY_MESSAGES_MESSAGE = 'Too many messages were sent. Try again later.'
export const MESSAGE_NOT_SENT_MESSAGE = 'The message could not be sent.'

/** Baked into a node's config at generation time; read and removed by the guard. */
export const VISITOR_RECIPIENT_FIELDS_KEY = '__visitorRecipientFields'
export const ESCAPE_BODY_KEY = '__escapeBody'
/** Baked when the send must never go out; the value is the reason, logged by the guard. */
export const REFUSE_SEND_KEY = '__refuseSend'
/** Baked on a public webhook's sends: its caller is an integration, so no per-visitor count. */
export const NO_IP_CAP_KEY = '__noIpCap'
/** Set on this deployment's own call to a custom node made for a public webhook. */
export const PUBLIC_CALLER_HEADER = 'x-teleport-public-caller'

const RECIPIENT_FIELDS: Record<'email' | 'sms', string[]> = {
  email: ['to', 'cc', 'bcc'],
  sms: ['to'],
}

const SENDER_FIELDS: Record<'email' | 'sms', string[]> = {
  email: ['from', 'fromName'],
  sms: ['from'],
}

const channelOf = (nodeType: string): 'email' | 'sms' =>
  nodeType.startsWith('sms-') ? 'sms' : 'email'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isSecretRef = (value: Record<string, unknown>): boolean =>
  value.type === 'dynamic' &&
  isRecord(value.content) &&
  (value.content as Record<string, unknown>).referenceType === 'secret'

/** A whole `{{Current User.<field>}}` / `{{currentUser.<field>}}` token. */
const SESSION_USER_TOKEN =
  /^\s*\{\{\s*(?:Current User|currentUser)\.[A-Za-z_$][A-Za-z0-9_$]*\s*\}\}\s*$/

const WHOLE_TOKEN = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/

/** What a route resolves on the server rather than from the request. */
interface TrustedSources {
  /** Owner-settings reads and owner-notification builders (message-trust). */
  owner: Set<string>
  /** The platform's HTML builders (message-trust). */
  html: Set<string>
  /** The route fills the visitor's identity from the session cookie. */
  sessionBound: boolean
  /** The current-user readers, whose result the route rebuilds from the session. */
  identityNodeIds: Set<string>
}

/**
 * A recipient or sender value the request cannot choose: an author literal,
 * a project secret, the signed-in user's own value (a current-user token or
 * reader, where the route binds the session), or an owner read.
 */
const isOwnerValue = (value: unknown, sources: TrustedSources): boolean => {
  if (value === undefined || value === null || value === '' || typeof value !== 'object') {
    if (typeof value !== 'string') {
      return true
    }
    if (sources.sessionBound && SESSION_USER_TOKEN.test(value)) {
      return true
    }
    return value.indexOf('{{') === -1 && value.indexOf('context-value-inline') === -1
  }
  if (Array.isArray(value)) {
    return value.every((item) => isOwnerValue(item, sources))
  }
  const record = value as Record<string, unknown>
  if (record.type === 'workflowContext') {
    const id = typeof record.nodeId === 'string' ? record.nodeId : ''
    return sources.owner.has(id) || (sources.sessionBound && sources.identityNodeIds.has(id))
  }
  if (record.type === 'ctx') {
    return false
  }
  if (isSecretRef(record)) {
    return true
  }
  return Object.keys(record).every((key) => isOwnerValue(record[key], sources))
}

/** A body that is one value (a reference or a whole `{{…}}` token). */
const isValueBody = (body: unknown): boolean =>
  (isRecord(body) && (body.type === 'workflowContext' || body.type === 'ctx')) ||
  (typeof body === 'string' && WHOLE_TOKEN.test(body))

/** A whole `{{key}}` token naming one of the node's `templateParams` is that param's value. */
const valueSourceOf = (value: unknown, config: Record<string, unknown>): unknown => {
  const token = typeof value === 'string' ? WHOLE_TOKEN.exec(value) : null
  const params = Array.isArray(config.templateParams) ? config.templateParams : []
  const param = token
    ? params.find((p) => isRecord(p) && (p as Record<string, unknown>).key === token[1])
    : undefined
  return param ? (param as Record<string, unknown>).value : value
}

/** The node a rich-text placeholder's opening tag names. */
const chipRefOf = (openTag: string): { type: 'workflowContext'; nodeId: string } => {
  const id = /data-ctx-node-id=["']([^"']*)["']/.exec(openTag)
  return { type: 'workflowContext', nodeId: id ? id[1] : '' }
}

/**
 * The values a body is made of when it has no author text — one value, a
 * whole token, or markup around placeholders / `{{tokens}}` only (an SMS:
 * parts that are all values) — or null when the author wrote text.
 */
const valueSourcesOfBody = (body: unknown, config: Record<string, unknown>): unknown[] | null => {
  if (isValueBody(body)) {
    return [valueSourceOf(body, config)]
  }
  if (Array.isArray(body)) {
    return body.length > 0 && body.every(isValueBody)
      ? body.map((part) => valueSourceOf(part, config))
      : null
  }
  if (typeof body !== 'string') {
    return null
  }
  const sources: unknown[] = []
  let text = ''
  let i = 0
  while (i < body.length) {
    const start = body.indexOf('<span', i)
    const openEnd = start === -1 ? -1 : body.indexOf('>', start)
    if (start === -1 || openEnd === -1) {
      text += body.slice(i)
      break
    }
    const openTag = body.slice(start, openEnd + 1)
    if (openTag.indexOf('context-value-inline') === -1) {
      text += body.slice(i, openEnd + 1)
      i = openEnd + 1
      continue
    }
    text += body.slice(i, start)
    sources.push(chipRefOf(openTag))
    let depth = 1
    let j = openEnd + 1
    while (j < body.length && depth > 0) {
      const nextOpen = body.indexOf('<span', j)
      const nextClose = body.indexOf('</span>', j)
      if (nextClose === -1) {
        j = body.length
        break
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const innerEnd = body.indexOf('>', nextOpen)
        j = innerEnd === -1 ? body.length : innerEnd + 1
        depth++
      } else {
        j = nextClose + '</span>'.length
        depth--
      }
    }
    i = j
  }
  text = text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token) => {
    sources.push(valueSourceOf(token, config))
    return ''
  })
  const authorText = text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, '')
    .replace(/\s+/g, '')
  return sources.length > 0 && authorText === '' ? sources : null
}

const isTrustedHtmlSource = (source: unknown, sources: TrustedSources): boolean =>
  isRecord(source) &&
  source.type === 'workflowContext' &&
  typeof source.nodeId === 'string' &&
  sources.html.has(source.nodeId)

/**
 * Callers that are not visitors: this deployment's own server code
 * (`serverOnly`), or a signed-in role a visitor cannot give itself.
 *
 * INVARIANT: this holds only while no visitor can obtain a role other than
 * `user` by themselves — signup always grants `user` (auth-generator,
 * account-signup). A feature that lets a visitor acquire another role (a
 * purchase that grants one) must make this check name the self-service roles.
 */
const isPrivilegedRoute = (protection: UIDLWorkflowProtection | undefined): boolean => {
  if (!protection) {
    return false
  }
  if (protection.serverOnly) {
    return true
  }
  const roles = Array.isArray(protection.allowedRoles) ? protection.allowedRoles : []
  return protection.requiresAuth === true && roles.length > 0 && roles.indexOf('user') === -1
}

export interface MessageMarkOptions {
  /** No build-log line for a refused send: the editor's check, which reports it itself. */
  silent?: boolean
}

/**
 * A refused send in the owner's words: the build log's line, and what the
 * editor shows before a publish (`collectWorkflowPublishRefusals`).
 */
export const describeRefusedSend = (
  workflowName: string,
  stepName: string,
  refusal: string
): string =>
  `Workflow "${workflowName}": the step "${stepName}" ${refusal}, so it will never send. Write the ` +
  "message in the step (place the visitor's values in it), use a fixed sender, and " +
  "put the visitor's address in Reply-To."

/**
 * The segment with every email/SMS node whose recipient the request can
 * choose marked for the guard, every whole-value body marked to be escaped,
 * and every send that must never go out marked refused (with the reason in
 * the build log). Nodes that need no mark — and a segment without such nodes
 * — are returned as they are, so their routes stay byte for byte the same.
 *
 * `trust.messageTrust` (from segment-trust, over the whole graph) names the
 * results the guard may trust; without it only this segment's own owner reads
 * and builders count.
 */
export const markVisitorBoundMessageNodes = (
  segment: WorkflowSegment,
  trust: SegmentTrust | undefined,
  protection: UIDLWorkflowProtection | undefined,
  workflowName?: string,
  options: MessageMarkOptions = {}
): WorkflowSegment => {
  if (!segment.nodes.some((node) => isOutboundMessageNodeType(node.type))) {
    return segment
  }
  if (isPrivilegedRoute(protection)) {
    return segment
  }
  const session = trust && trust.session
  const messageTrust: MessageTrust =
    (trust && trust.messageTrust) ||
    collectMessageTrust({
      nodes: segment.nodes,
      edges: segment.edges,
      serverNodeIds: new Set(segment.nodes.map((node) => node.id)),
    })
  const sources: TrustedSources = {
    owner: new Set(messageTrust.ownerRecipientNodeIds),
    html: new Set(messageTrust.trustedHtmlNodeIds),
    sessionBound: !!session,
    identityNodeIds: new Set(session ? Object.keys(session.identityNodes || {}) : []),
  }
  let changed = false
  const nodes = segment.nodes.map((node): UIDLWorkflowNode => {
    if (!isOutboundMessageNodeType(node.type) || !isRecord(node.config)) {
      return node
    }
    const config = node.config as Record<string, unknown>
    const channel = channelOf(node.type)
    const visitorFields = RECIPIENT_FIELDS[channel].filter(
      (field) => !isOwnerValue(config[field], sources)
    )
    const bodyKey = channel === 'email' ? 'body' : 'message'
    const bodySources = valueSourcesOfBody(config[bodyKey], config)
    const htmlBody =
      bodySources !== null && bodySources.every((source) => isTrustedHtmlSource(source, sources))
    const visitorSender = SENDER_FIELDS[channel].find(
      (field) => !isOwnerValue(config[field], sources)
    )
    let refusal = ''
    if (visitorFields.length > 0 && bodySources !== null && !htmlBody) {
      refusal =
        "sends a message that is only the visitor's input to an address the visitor supplies"
    } else if (visitorSender) {
      refusal = `takes its sender (${visitorSender}) from the visitor`
    }
    const escapeBody = channel === 'email' && isValueBody(config.body) && !htmlBody && !refusal
    if (visitorFields.length === 0 && !escapeBody && !refusal) {
      return node
    }
    if (refusal && !options.silent) {
      // The build log is where a generation refusal reaches the owner.
      // tslint:disable-next-line:no-console
      console.warn(
        `[teleport-plugin-next-workflows] ${describeRefusedSend(
          workflowName || segment.id,
          stepNameOf(node),
          refusal
        )}`
      )
    }
    changed = true
    return {
      ...node,
      config: {
        ...config,
        ...(visitorFields.length > 0 ? { [VISITOR_RECIPIENT_FIELDS_KEY]: visitorFields } : {}),
        ...(escapeBody ? { [ESCAPE_BODY_KEY]: true } : {}),
        ...(refusal ? { [REFUSE_SEND_KEY]: refusal } : {}),
      },
    } as UIDLWorkflowNode
  })
  return changed ? { ...segment, nodes } : segment
}

/**
 * A webhook route whose payload no provider signature vouches for is as
 * public as a page's route: its email/SMS nodes are marked the same way, with
 * the webhook's payload (the trigger) as visitor input. Its caller is an
 * integration, not a visitor, so its sends are counted per recipient and per
 * site only. A verified webhook (a payment provider's, or any verified
 * signature scheme) keeps its nodes as they are. `marked` says whether a send
 * counts visitor-supplied recipients.
 */
export const markWebhookMessageNodes = (
  workflow: { id: string; name?: string; nodes: UIDLWorkflowNode[]; edges: UIDLWorkflowEdge[] },
  serverNodes: UIDLWorkflowNode[],
  serverEdges: UIDLWorkflowEdge[],
  verified: boolean,
  options: MessageMarkOptions = {}
): { nodes: UIDLWorkflowNode[]; marked: boolean } => {
  if (verified || !serverNodes.some((node) => isOutboundMessageNodeType(node.type))) {
    return { nodes: serverNodes, marked: false }
  }
  const segment = {
    id: workflow.id,
    env: 'server',
    nodeIds: serverNodes.map((node) => node.id),
    nodes: serverNodes,
    edges: serverEdges,
  } as WorkflowSegment
  const trust = {
    messageTrust: collectMessageTrust({
      nodes: workflow.nodes,
      edges: workflow.edges,
      serverNodeIds: new Set(serverNodes.map((node) => node.id)),
    }),
  } as SegmentTrust
  const result = markVisitorBoundMessageNodes(
    segment,
    trust,
    undefined,
    workflow.name || workflow.id,
    options
  )
  let marked = false
  const nodes = result.nodes.map((node) => {
    if (!isRecord(node.config) || !Array.isArray(node.config[VISITOR_RECIPIENT_FIELDS_KEY])) {
      return node
    }
    marked = true
    return { ...node, config: { ...node.config, [NO_IP_CAP_KEY]: true } } as UIDLWorkflowNode
  })
  return { nodes, marked }
}

/**
 * The statement an unsigned webhook route adds when it calls a custom node:
 * the custom node's route then counts that call's visitor-supplied sends (per
 * recipient and per site) instead of exempting it as this deployment's own.
 * The header is read only on a call that carries the internal-call token.
 */
export const PUBLIC_CALLER_INJECTION = `\n    context.__internalHeaders['${PUBLIC_CALLER_HEADER}'] = '1';`

/**
 * Emitted before every email/SMS handler: `__outboundMessageGuard(channel,
 * config, context)` resolves `null` when the send may go on, after it has
 * cleaned `config` in place (so the sent-email ledger records what was sent);
 * `{ skipped }` when a limit was reached (the node answers a skipped, non-fatal
 * result: the visitor's action goes on); `{ error }` when the send is refused
 * (refused at generation, or no security runtime: a fatal result). It never
 * throws.
 *
 * Without the security runtime (no `relativePrefix`) a visitor-bound send is
 * refused; every other send only gets its headers cleaned.
 */
export const generateOutboundMessageGuardCode = (
  relativePrefix?: string
): string => `${generateSecurityRuntimeVar('__outboundSecurity', relativePrefix)}
${VISITOR_KEY_CODE}
var __outboundMessageGuard = typeof __outboundMessageGuard !== 'undefined' ? __outboundMessageGuard : async function __outboundMessageGuard(channel, config, context) {
  var TOO_MANY = ${JSON.stringify(TOO_MANY_MESSAGES_MESSAGE)};
  var NOT_SENT = ${JSON.stringify(MESSAGE_NOT_SENT_MESSAGE)};
  function withoutLineBreaks(value) {
    if (typeof value === 'string') return value.replace(/[\\r\\n]+/g, ' ');
    if (Array.isArray(value)) return value.map(withoutLineBreaks);
    if (value && typeof value === 'object') {
      var copy = {};
      Object.keys(value).forEach(function (key) { copy[key] = withoutLineBreaks(value[key]); });
      return copy;
    }
    return value;
  }
  function escapeHtml(text) {
    return ${escapeHtmlValueJs('text')};
  }
  // One parameter on purpose: a two-parameter declaration ahead of the node's
  // own entry would be taken for it (see resolveHandlerEntryName).
  var recipients = [];
  function collectRecipients(value) {
    if (Array.isArray(value)) { value.forEach(collectRecipients); return; }
    if (value && typeof value === 'object') { collectRecipients(value.email !== undefined ? value.email : value.to); return; }
    if (value === undefined || value === null) return;
    String(value).split(/[,;]/).forEach(function (part) {
      var address = part.trim();
      if (channel === 'sms') {
        // E.164: one number however it is written (+1 555…, 1555…, 001555…).
        var phone = address.replace(/[^0-9+]/g, '');
        var international = phone.charAt(0) === '+';
        phone = phone.replace(/[+]/g, '');
        if (!international && phone.indexOf('00') === 0) phone = phone.slice(2);
        address = phone ? '+' + phone : '';
      } else {
        // Lower-cased, without a +tag: one mailbox however it is written.
        var bracketed = /<([^<>]+)>/.exec(address);
        address = (bracketed ? bracketed[1] : address).trim().toLowerCase();
        var at = address.lastIndexOf('@');
        var tag = at > 0 ? address.slice(0, at).indexOf('+') : -1;
        if (tag > 0) address = address.slice(0, tag) + address.slice(at);
        // Gmail ignores dots in the mailbox name.
        at = address.lastIndexOf('@');
        var domain = at > 0 ? address.slice(at + 1) : '';
        if (domain === 'gmail.com' || domain === 'googlemail.com') {
          address = address.slice(0, at).replace(/[.]/g, '') + '@gmail.com';
        }
      }
      if (address && recipients.indexOf(address) === -1) recipients.push(address);
    });
  }
  try {
    if (!config || typeof config !== 'object') return null;
    var headerFields = channel === 'sms' ? ['from', 'to'] : ['from', 'fromName', 'to', 'cc', 'bcc', 'replyTo', 'subject'];
    headerFields.forEach(function (field) {
      if (config[field] !== undefined) config[field] = withoutLineBreaks(config[field]);
    });
    var refusal = typeof config.${REFUSE_SEND_KEY} === 'string' ? config.${REFUSE_SEND_KEY} : '';
    var escapeBody = config.${ESCAPE_BODY_KEY} === true;
    var fields = Array.isArray(config.${VISITOR_RECIPIENT_FIELDS_KEY}) ? config.${VISITOR_RECIPIENT_FIELDS_KEY} : [];
    var noIpCap = config.${NO_IP_CAP_KEY} === true;
    delete config.${REFUSE_SEND_KEY};
    delete config.${ESCAPE_BODY_KEY};
    delete config.${VISITOR_RECIPIENT_FIELDS_KEY};
    delete config.${NO_IP_CAP_KEY};
    // Refused when the site was generated (the build log names the step).
    if (refusal) {
      console.error('[' + channel + '] send refused: the step ' + refusal);
      return { error: NOT_SENT };
    }
    if (escapeBody && config.body !== undefined && config.body !== null) {
      config.body = escapeHtml(String(config.body));
    }
    if (fields.length === 0) return null;
    var request = context && context.__request;
    // This deployment's own server code (a webhook or cron running a custom
    // node) is not a visitor — unless it calls for a public webhook, whose
    // sends count per recipient and per site (the header is honoured only on
    // a call that carries the internal-call token).
    if (request && request.internal === true) {
      var headers = request.headers && typeof request.headers === 'object' ? request.headers : {};
      if (headers['${PUBLIC_CALLER_HEADER}'] !== '1') return null;
      noIpCap = true;
    }
    fields.forEach(function (field) { collectRecipients(config[field]); });
    if (recipients.length === 0) return null;
    var security = __outboundSecurity;
    if (!security || typeof security.rateLimit !== 'function' || typeof security.clientIp !== 'function') {
      console.error('[' + channel + '] send refused: the security runtime is not available');
      return { error: NOT_SENT };
    }
    var scope = channel + '-visitor-recipient';
    var visitor = __visitorKeyOf(security, request);
    for (var i = 0; i < recipients.length; i++) {
      var checks = [
        { key: JSON.stringify([scope, 'recipient', recipients[i]]), limit: ${VISITOR_SENDS_PER_RECIPIENT_PER_HOUR}, windowSeconds: 3600 },
        { key: 'site:' + scope, limit: ${VISITOR_SENDS_PER_SITE_PER_DAY}, windowSeconds: 86400 }
      ];
      if (!noIpCap) {
        checks.unshift({ key: JSON.stringify([scope, 'ip', visitor]), limit: ${VISITOR_SENDS_PER_IP_PER_HOUR}, windowSeconds: 3600 });
      }
      for (var c = 0; c < checks.length; c++) {
        var verdict = await security.rateLimit(checks[c]);
        if (!verdict || !verdict.allowed) {
          console.warn('[' + channel + '] send skipped: a limit on visitor-supplied recipients was reached');
          return { skipped: TOO_MANY };
        }
      }
    }
    return null;
  } catch (err) {
    console.error('[' + channel + '] send refused:', err && err.message ? err.message : err);
    return { error: NOT_SENT };
  }
};`

/**
 * The two sources of an email/SMS node: the guard, then the node. A server
 * route passes where it sits; anything else gets a guard without the runtime.
 */
export const outboundMessageHandlerSources = (
  handler: HandlerFn
): Pick<NodeHandlerGenerator, 'generateHandler' | 'generateServerHandler'> => ({
  generateHandler: () => generateOutboundMessageGuardCode() + '\n\n' + handlerToString(handler),
  generateServerHandler: (options?: ServerHandlerOptions) =>
    generateOutboundMessageGuardCode(serverHandlerPrefix(options)) +
    '\n\n' +
    handlerToString(handler),
})
