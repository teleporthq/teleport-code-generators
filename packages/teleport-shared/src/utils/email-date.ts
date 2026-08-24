/**
 * Date rendering for generated transactional emails.
 *
 * An email merge token is a bare field NAME (`{{orderDate}}`) — there is no
 * `{{orderDate | date}}` — and the builder's email serializer drops a date
 * node's display format, because a token cannot carry one. So whatever string a
 * generator puts in the token is exactly what the recipient reads, ISO `T`/`Z`
 * and all. The only fix is to format the VALUE, which is what this emitter is
 * for.
 *
 * Mirrors the editor's copy in teleport-gui
 * `app/project-page/features/e-commerce/utils/email-date-script.ts`, so a store
 * gets the same shape whether the mail was sent by the baked workflow node or by
 * a generated API route. Keep the two in lockstep.
 */

/** `Aug 21, 2026 5:53 PM UTC` — the shape `generateEmailDateHelperCode` emits. */
export const EMAIL_DATE_FORMAT = 'MMM D, YYYY h:mm A'

/**
 * ES5 source for a `<fnName>(value)` helper rendering `EMAIL_DATE_FORMAT` in
 * UTC.
 *
 * UTC, and labelled as such, because the merchant, the buyer and the server can
 * all sit in different zones and a bare local time on a receipt is ambiguous.
 * Anything unparseable is returned as-is rather than blanked — a visibly odd
 * date is recoverable, a missing one is not.
 */
export const generateEmailDateHelperCode = (fnName: string = 'formatEmailDate'): string => `
function ${fnName}(value) {
  if (value == null || value === '') return ''
  var d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return String(value)
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  var hours24 = d.getUTCHours()
  var suffix = hours24 >= 12 ? 'PM' : 'AM'
  var hours12 = hours24 % 12
  if (hours12 === 0) hours12 = 12
  var minutes = String(d.getUTCMinutes())
  if (minutes.length < 2) minutes = '0' + minutes
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() +
    ' ' + hours12 + ':' + minutes + ' ' + suffix + ' UTC'
}
`
