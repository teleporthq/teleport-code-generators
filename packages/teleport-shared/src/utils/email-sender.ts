/**
 * The sender ("From") of an email a published site sends, as ES5 source for the
 * generated runtime code that cannot import from this package: the workflow
 * email nodes, the welcome and farewell routes, the invoice sender and the
 * store's order-notification sender. One rule, so every path names the sender
 * the same way.
 *
 * The editor stores the sender as an address plus a separate display name
 * (`from` and `fromName`). A provider takes it either as one RFC 5322 mailbox
 * string (Postmark, Resend, Mailgun, nodemailer) or as its two parts
 * (SendGrid's `{ email, name }`, MailerSend's `Sender`), so the emitted
 * `__emailSender({ from, name })` answers both: `{ email, name, header }`.
 *
 * - No name: the bare address, as before.
 * - A name holding an RFC 5322 special — `( ) < > [ ] : ; @ \ , . "` — is
 *   quoted, its `"` and `\` escaped. Unquoted, `Smith, Jones & Co <a@x.test>`
 *   reaches the provider as two addresses.
 * - Line breaks and other control characters become spaces: a header ends at a
 *   line break, so a name carrying one would break the header.
 * - A `from` that already names its sender (`Shop <a@x.test>`) keeps that name
 *   and is never wrapped a second time; a name typed with its own quotes is not
 *   quoted twice.
 *
 * ⛔ ONE parameter. The source is appended to serialized node handlers whose
 * entry point a minified build finds by arity (a 2-param declaration wins, see
 * `resolveHandlerEntryName`), so a 2-param helper would be called in place of
 * the handler. A string literal rather than a `.toString()`, so a consumer's
 * minifier can neither drop nor rename the declaration (see
 * `commerce-tracking.ts` in teleport-plugin-next-workflows).
 */

/** What a caller passes: the stored address and display name. */
export interface EmailSenderInput {
  from?: unknown
  name?: unknown
}

/** What the emitted helper answers. */
export interface EmailSenderParts {
  email: string
  name: string
  header: string
}

export const generateEmailSenderHelperCode = (): string => `
// The sender of an email as { email, name, header }: header is the mailbox for a
// provider taking the From as one string, email and name are its two parts.
function __emailSender(sender) {
  function text(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
  function plainName(value) {
    var name = text(value).replace(/[\\s\\u0000-\\u001f\\u007f]+/g, ' ').trim();
    var quoted = /^"((?:[^"\\\\]|\\\\.)*)"$/.exec(name);
    return quoted ? quoted[1].replace(/\\\\(.)/g, '$1').trim() : name;
  }
  var email = text(sender && sender.from).trim();
  var name = plainName(sender && sender.name);
  var named = /^([^<>]*)<([^<>]*)>$/.exec(email);
  if (named) {
    email = named[2].trim();
    name = plainName(named[1]) || name;
  } else if (/[<>]/.test(email)) {
    return { email: email, name: '', header: email };
  }
  if (!email || !name) {
    return { email: email, name: '', header: email };
  }
  var display = /[()<>\\[\\]:;@\\\\,."]/.test(name)
    ? '"' + name.replace(/(["\\\\])/g, '\\\\$1') + '"'
    : name;
  return { email: email, name: name, header: display + ' <' + email + '>' };
}
`
