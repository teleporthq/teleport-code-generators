/**
 * Which generated code sends email, and therefore which projects get the
 * sent-email ledger module (`utils/email/sent-email-log.js`).
 *
 * Every emitter of a send path calls `ensureSentEmailLogModule` itself, so the
 * module exists exactly when something `require`s it. This file only holds the
 * node-type vocabulary the route generators share.
 */

export const SENT_EMAIL_LOG_FILE_KEY = 'sent-email-log'
export const SENT_EMAIL_LOG_PATH = ['utils', 'email']
export const SENT_EMAIL_LOG_FILE_NAME = 'sent-email-log'

/** Provider send-email nodes: `email-resend`, `email-sendgrid`, … */
export const EMAIL_NODE_TYPE_PREFIX = 'email-'

/**
 * Integration nodes that can send mail among other actions. Only their
 * `send-email` action is recorded; the wrapper checks the resolved config.
 */
export const EMAIL_CAPABLE_INTEGRATION_NODE_TYPES = new Set([
  'integration-gmail',
  'integration-outlook',
])

export const isEmailSendingNodeType = (nodeType: string): boolean =>
  nodeType.startsWith(EMAIL_NODE_TYPE_PREFIX) || EMAIL_CAPABLE_INTEGRATION_NODE_TYPES.has(nodeType)

export const hasEmailSendingNodeType = (nodeTypes: Iterable<string>): boolean => {
  for (const nodeType of nodeTypes) {
    if (isEmailSendingNodeType(nodeType)) {
      return true
    }
  }
  return false
}
