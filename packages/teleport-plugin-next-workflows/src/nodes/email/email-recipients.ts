/**
 * How a workflow email node reaches SEVERAL recipients: one provider call per
 * address, so one refused address (a sender that only delivers to the account
 * owner, a provider account still pending approval) never blocks the others,
 * and the sent-email ledger can say exactly who got the email.
 *
 * Appended to the five `email-*` handlers the way `__emailSender` is: a
 * serialized handler has no module scope, so each declares these ambiently
 * and `generateHandler` concatenates this source. A STRING LITERAL with
 * ONE-parameter functions, for the reasons `commerce-tracking.ts` gives (a
 * consumer's minifier inlines a single-use `.toString()`, and
 * `resolveHandlerEntryName` picks a minified entry point by its 2-param arity).
 */

export interface EmailDelivery {
  to: string
  success: boolean
  id?: string
  messageId?: string
  error?: string
}

export interface EmailDeliveriesPlan {
  recipients: unknown[]
  send: (recipient: unknown) => Promise<unknown>
  /** The key the handler reports the provider's message id under. */
  idKey: 'id' | 'messageId'
}

export const EMAIL_RECIPIENTS_HELPER_SOURCE = `
// The address of one recipient entry: a string, or MailerSend's { email, name }.
function __emailAddressOf(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object' && typeof entry.email === 'string') return entry.email.trim();
  return '';
}

// A node's \`to\` as a list with no empty entries and no address twice
// (case-insensitive); each entry keeps the shape it arrived in.
function __emailRecipients(to) {
  var entries = Array.isArray(to) ? to : [to];
  var seen = {};
  var recipients = [];
  for (var i = 0; i < entries.length; i++) {
    var key = __emailAddressOf(entries[i]).toLowerCase();
    if (!key || seen[key]) continue;
    seen[key] = true;
    recipients.push(entries[i]);
  }
  return recipients;
}

// Sends to each recipient in turn through plan.send (one recipient per call)
// and reports the whole: the first delivered id, success when at least one
// was delivered, the refused addresses with their reasons, and one delivery
// per recipient.
async function __emailDeliveries(plan) {
  var deliveries = [];
  for (var i = 0; i < plan.recipients.length; i++) {
    var recipient = plan.recipients[i];
    var outcome;
    try {
      outcome = await plan.send(recipient);
    } catch (err) {
      outcome = { success: false, error: (err && err.message) || String(err) };
    }
    var delivery = { to: __emailAddressOf(recipient), success: outcome.success === true };
    if (delivery.success) {
      delivery[plan.idKey] = outcome[plan.idKey] || '';
    } else {
      delivery.error = outcome.error || 'Failed to send email';
    }
    deliveries.push(delivery);
  }
  var delivered = deliveries.filter(function (d) { return d.success; });
  var refused = deliveries.filter(function (d) { return !d.success; });
  var result = {};
  result[plan.idKey] = delivered.length ? delivered[0][plan.idKey] : '';
  result.success = delivered.length > 0;
  if (refused.length) {
    result.error = 'refused for ' + refused.map(function (d) { return d.to + ' (' + d.error + ')'; }).join('; ');
  }
  result.deliveries = deliveries;
  return result;
}
`
