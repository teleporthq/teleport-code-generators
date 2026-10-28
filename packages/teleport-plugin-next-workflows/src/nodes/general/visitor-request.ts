import type { ServerHandlerOptions } from '../types'
import { securityRuntimeSpecifier } from '../../security-runtime/security-runtime-code'

/**
 * What the server handlers that limit or send on a visitor's behalf share:
 * where the route they are inlined into sits, the shared security runtime
 * (`utils/security-runtime.js`), and the visitor a request comes from.
 */

/**
 * The prefix from the route a server handler is inlined into to the project
 * root. Segment routes (`pages/api/workflows/<file>.js`) pass none.
 */
export const serverHandlerPrefix = (options?: ServerHandlerOptions): string =>
  (options && options.relativePrefix) || '../../..'

/** Email and SMS provider nodes: `email-resend`, `sms-twilio`, … */
export const isOutboundMessageNodeType = (nodeType: string): boolean =>
  nodeType.startsWith('email-') || nodeType.startsWith('sms-')

/**
 * A route running one of these hands its nodes the visitor's request
 * (`context.__request`). The newsletter sign-up reads it for the links it
 * mails (the site's origin) and the email's language.
 */
export const needsVisitorRequest = (nodeTypes: Iterable<string>): boolean => {
  for (const nodeType of nodeTypes) {
    if (
      nodeType === 'general-rate-limiter' ||
      nodeType === 'newsletter-subscribe' ||
      isOutboundMessageNodeType(nodeType)
    ) {
      return true
    }
  }
  return false
}

/**
 * The route statement that hands the nodes the request they serve: its
 * headers and socket address (the visitor's address is read from them by the
 * security runtime's `clientIp`, only where the host guarantees it), and
 * whether this deployment's own server code made the call. Set after the
 * request context is copied, so a body cannot supply it.
 */
export const VISITOR_REQUEST_INJECTION =
  "\n    context.__request = { headers: req.headers || {}, remoteAddress: (req.socket && req.socket.remoteAddress) || '', internal: utils.isInternalCall(req) };"

/**
 * Emitted: `var <name>` holding the security runtime. Without a prefix (a
 * handler emitted for no known route) it is `null`, and whatever needs it
 * refuses. The `require` is a static one, so the bundler includes the file; it
 * is only emitted where the prefix is known to be right.
 */
export const generateSecurityRuntimeVar = (name: string, relativePrefix?: string): string => {
  const value = relativePrefix
    ? `(function () { try { return require('${securityRuntimeSpecifier(
        relativePrefix
      )}'); } catch (_e) { return null; } })()`
    : 'null'
  return `var ${name} = typeof ${name} !== 'undefined' ? ${name} : ${value};`
}

/**
 * Emitted: `__visitorKeyOf(security, request)` — the visitor a request comes
 * from, read by `security.clientIp` from what the route put in
 * `context.__request` and keyed by `security.visitorKey` (an IPv6 visitor by
 * its /64: one visitor holds the whole block), the one rule every limiter of
 * the app keys a visitor by. 'unknown' when there is no request, so every
 * such call shares one bucket.
 */
export const VISITOR_KEY_CODE = `var __visitorKeyOf = typeof __visitorKeyOf !== 'undefined' ? __visitorKeyOf : function __visitorKeyOf(security, request) {
  if (!request || typeof request !== 'object') return 'unknown';
  var ip = security.clientIp({
    headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
    socket: { remoteAddress: typeof request.remoteAddress === 'string' ? request.remoteAddress : '' }
  });
  return security.visitorKey(ip) || 'unknown';
};`
