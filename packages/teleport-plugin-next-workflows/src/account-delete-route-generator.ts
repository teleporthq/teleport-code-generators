/**
 * Generates the dedicated API route that backs the `account-delete-current`
 * workflow node: `pages/api/account/delete-current.js`.
 *
 * The client node calls this route, which:
 *   1. resolves the current user from the NextAuth session (never trusting a
 *      client-supplied id) and, when the request carries a password, goes on
 *      only if it is the account's own,
 *   2. runs a single DB transaction that detaches + anonymises business/legal
 *      records (orders, withdrawal requests, bookings, downloads, gift cards
 *      the user bought or received) so tracking survives, takes the user's
 *      email out of the activity log and the sent-email ledger, leaves the
 *      invoices already issued as they are (an invoice must keep naming its
 *      buyer),
 *      deletes the user's personal data (reviews, cart, favourites, chat
 *      history), deletes the rows the user owns in the project's own tables —
 *      the ones the AI made for the site, each through the one column the
 *      site's "My …" pages read it by (teleport-shared's resolveOwnerColumn,
 *      shipped into the route as text) — and then the user row, and
 *   3. best-effort sends the farewell email (a failed send never fails the
 *      deletion).
 *
 * Every platform-table statement is guarded by a runtime `information_schema`
 * column check, so the route is a no-op for feature tables a given project
 * never provisioned.
 */
import { UIDLLocalizedEmailTemplates } from '@teleporthq/teleport-types'
import { OwnerColumns } from '@teleporthq/teleport-shared'
import { generatePgClientCode } from './pg-client-code'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  transactionalEmailDependencies,
  generateProviderSendFunction,
  generateFillTemplateFn,
  generateEmailLocaleRequire,
  generateLocalizedEmailCopyFn,
} from './transactional-email-code'
import { generateAccountEventRecorder, PASSWORD_RESETS_TABLE } from './auth-generator'

export interface AccountDeleteRouteOptions {
  // The auth identity table (resolved by the plugin). Defaults to `users`.
  authUsersTableName?: string
  // Farewell email — omit any to disable the send. `emailProvider` is the id
  // WITHOUT the `email-` prefix (e.g. `resend`). `emailSecretEnvName` is the env
  // var the credential lives under (resolved from the node's secret reference).
  emailProvider?: string | null
  fromEmail?: string
  fromName?: string
  emailSecretEnvName?: string | null
  emailSubject?: string
  emailBodyHtml?: string
  // Per-language copies of the subject/body (main language excluded); the
  // route sends the copy matching the language the deletion came from.
  localizedTemplates?: UIDLLocalizedEmailTemplates
  // Human site/app name used to fill the `{{siteName}}` merge token.
  siteName?: string
  // Synthetic address written onto detached rows; `{{userId}}` is substituted.
  deletedEmailPattern?: string
  // The project has the in-app event bus (`hasAutomationsBus`): a committed
  // deletion is recorded as `user-deleted` for the automations.
  withAutomations?: boolean
}

// Kept as a named alias (imported by workflow-project-plugin.ts) so the delete
// route's dependency wiring stays stable while the impl lives in the shared module.
export const accountDeleteRouteDependencies = transactionalEmailDependencies

export const generateAccountDeleteRoute = (options: AccountDeleteRouteOptions = {}): string => {
  const authUsersTable = options.authUsersTableName || 'users'
  const provider =
    options.emailProvider && SUPPORTED_EMAIL_PROVIDERS.has(options.emailProvider)
      ? options.emailProvider
      : null
  const deletedEmailPattern =
    options.deletedEmailPattern || 'deleted-user-{{userId}}@deleted.invalid'
  const recordsDeletion = options.withAutomations === true

  return `${generatePgClientCode()}
${generateCommonJsSessionTokenResolverCode()}
const AUTH_USERS_TABLE = ${JSON.stringify(authUsersTable)};
const SITE_NAME = ${JSON.stringify(options.siteName || '')};
const DELETED_EMAIL_PATTERN = ${JSON.stringify(deletedEmailPattern)};
const EMAIL_PROVIDER = ${JSON.stringify(provider)};
const EMAIL_FROM = ${JSON.stringify(options.fromEmail || '')};
const EMAIL_FROM_NAME = ${JSON.stringify(options.fromName || '')};
const EMAIL_SECRET_ENV_NAME = ${JSON.stringify(options.emailSecretEnvName || '')};
const EMAIL_SUBJECT = ${JSON.stringify(options.emailSubject || 'Your account has been deleted')};
const EMAIL_BODY_HTML = ${JSON.stringify(options.emailBodyHtml || '')};
const EMAIL_LOCALIZED = ${JSON.stringify(options.localizedTemplates || {})};
${generateEmailLocaleRequire('../../..')}

// Personal data owned by the user — rows are DELETED (keyed by user_id). Messages
// are deleted before conversations so a conversation delete only cascades leftovers.
const DELETE_TABLES = [
  'teleport_product_reviews',
  'teleport_favourites',
  'teleport_cart',
  'teleport_ai_chat_messages',
  'teleport_ai_chat_conversations',
  // The account's password-reset links (user_id is text there).
  '${PASSWORD_RESETS_TABLE}',
  // A push subscription is the capability to notify the user's device.
  'teleport_push_subscriptions',
];
// Business / legal records that must survive: the user link is nulled and any
// stored personal email is replaced with a synthetic, self-describing address.
const ANONYMIZE_TABLES = [
  'teleport_orders',
  'teleport_withdrawal_requests',
  'teleport_bookings',
  'teleport_subscriptions',
  'teleport_abandoned_carts',
  'teleport_voucher_redemptions',
  'teleport_downloads',
];
const EMAIL_COLUMNS = ['billing_email', 'shipping_email', 'customer_email', 'email'];
// A booking also names the customer and carries their phone; both are cleared.
// A download keeps its count against the order's limit, without who fetched it
// from where.
const CLEARED_COLUMNS = {
  teleport_bookings: ['customer_name', 'customer_phone'],
  teleport_downloads: ['ip_address'],
};
// Tables that name the user only by their email: each column holding it takes
// the anonymised address (a gift card stays redeemable by its code) or a blank
// (an activity-log line keeps what happened, not who did it).
const EMAIL_REFERENCES = [
  { table: 'teleport_gift_cards', column: 'purchaser_email', replacement: 'anonymised' },
  { table: 'teleport_gift_cards', column: 'recipient_email', replacement: 'anonymised' },
  { table: 'teleport_events', column: 'actor', replacement: 'blank' },
];
const SENT_EMAILS_TABLE = 'teleport_sent_emails';

function anonymisedEmailOf(userId) {
  return String(DELETED_EMAIL_PATTERN).split('{{userId}}').join(String(userId));
}

async function tableColumns(client, table) {
  var r = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table]
  );
  var cols = [];
  for (var i = 0; i < r.rows.length; i++) { cols.push(r.rows[i].column_name); }
  return cols;
}

async function anonymizeUserRows(client, table, userId, syntheticEmail) {
  var cols = await tableColumns(client, table);
  if (cols.indexOf('user_id') === -1) { return; }
  var sets = ['user_id = NULL'];
  var params = [userId];
  for (var i = 0; i < EMAIL_COLUMNS.length; i++) {
    if (cols.indexOf(EMAIL_COLUMNS[i]) !== -1) {
      params.push(syntheticEmail);
      sets.push(EMAIL_COLUMNS[i] + ' = $' + params.length);
    }
  }
  var cleared = CLEARED_COLUMNS[table] || [];
  for (var c = 0; c < cleared.length; c++) {
    if (cols.indexOf(cleared[c]) !== -1) { sets.push(cleared[c] + ' = NULL'); }
  }
  await client.query('UPDATE ' + table + ' SET ' + sets.join(', ') + ' WHERE user_id = $1', params);
}

async function deleteUserRows(client, table, userId) {
  var cols = await tableColumns(client, table);
  if (cols.indexOf('user_id') === -1) { return; }
  await client.query('DELETE FROM ' + table + ' WHERE user_id = $1', [userId]);
}

async function deleteRowsByEmail(client, table, column, email) {
  if (!email) { return; }
  var cols = await tableColumns(client, table);
  if (cols.indexOf(column) === -1) { return; }
  await client.query('DELETE FROM ' + table + ' WHERE ' + column + ' = $1', [email]);
}

async function replaceEmailReferences(client, email, anonymisedEmail) {
  if (!email) { return; }
  for (var i = 0; i < EMAIL_REFERENCES.length; i++) {
    var ref = EMAIL_REFERENCES[i];
    var cols = await tableColumns(client, ref.table);
    if (cols.indexOf(ref.column) === -1) { continue; }
    await client.query(
      'UPDATE ' + ref.table + ' SET ' + ref.column + ' = $1 WHERE lower(' + ref.column + ') = lower($2)',
      [ref.replacement === 'anonymised' ? anonymisedEmail : '', email]
    );
  }
}

// The emails the site sent the user stay on record (which email, when, through
// which provider), without the address, the body or the values it was filled
// with.
async function blankSentEmailsTo(client, email) {
  if (!email) { return; }
  var cols = await tableColumns(client, SENT_EMAILS_TABLE);
  if (cols.indexOf('recipient_email') === -1) { return; }
  var sets = ["recipient_email = ''"];
  if (cols.indexOf('recipients') !== -1) { sets.push('recipients = NULL'); }
  if (cols.indexOf('body_html') !== -1) { sets.push("body_html = ''"); }
  if (cols.indexOf('payload') !== -1) { sets.push('payload = NULL'); }
  await client.query(
    'UPDATE ' + SENT_EMAILS_TABLE + ' SET ' + sets.join(', ') + ' WHERE lower(recipient_email) = lower($1)',
    [email]
  );
}

// Rows the user owns in the project's OWN tables — the ones the AI made for
// this site (saved items, requests, reviews …). Their link to the user is
// ON DELETE SET NULL, so they outlived the account with a blank owner, and the
// "My …" pages read "owner = me OR owner IS NULL": every other signed-in
// visitor saw them. Platform tables keep the explicit handling above —
// deleted, anonymised, or kept as the business's records.
//
// Each table is attributed through exactly ONE column, the one its "My …"
// pages read it by: resolveOwnerColumn below is the AI pipeline's own
// decision, shipped here as text, so the two sides cannot disagree. Rows go
// only through an "owner" column (whose the row is: author, submitter,
// sender); an "actor" column (who approved, reviewed, was assigned or
// addressed) names somebody else's row and leaves the table alone.
${OwnerColumns.generateOwnerColumnResolverCode()}

const PLATFORM_TABLE_PREFIX = 'teleport_';
const PLATFORM_TABLES = [AUTH_USERS_TABLE, 'password_reset_tokens'];

function isPlatformTable(table) {
  return PLATFORM_TABLES.indexOf(table) !== -1 || table.indexOf(PLATFORM_TABLE_PREFIX) === 0;
}

function quoteIdentifier(name) {
  return '"' + String(name).split('"').join('""') + '"';
}

// The (table, column) pairs through which the project's own tables name their
// owner: the resolved owner column when it references the users table — or
// references nothing, in older projects whose link was dropped. One that
// references another table (account_id -> accounts) is a domain link and the
// table is left alone. Links are read from pg_constraint rather than
// information_schema: constraint names are only unique per table, so a join
// by name can pair the wrong tables.
async function ownedRowLinks(client) {
  var columns = await client.query(
    "SELECT c.table_name, c.column_name, c.ordinal_position FROM information_schema.columns c" +
      " JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name" +
      " WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'" +
      " ORDER BY c.table_name, c.ordinal_position"
  );
  var links = await client.query(
    "SELECT cl.relname AS table_name, a.attname AS column_name," +
      " rcl.relname AS referenced_table, ra.attname AS referenced_column" +
      " FROM pg_constraint k" +
      " JOIN pg_class cl ON cl.oid = k.conrelid" +
      " JOIN pg_namespace n ON n.oid = cl.relnamespace" +
      " JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]" +
      " JOIN pg_class rcl ON rcl.oid = k.confrelid" +
      " JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = k.confkey[1]" +
      " WHERE k.contype = 'f' AND n.nspname = 'public' AND array_length(k.conkey, 1) = 1"
  );
  var referenced = {};
  for (var i = 0; i < links.rows.length; i++) {
    var link = links.rows[i];
    referenced[link.table_name + '.' + link.column_name] = link.referenced_table + '.' + link.referenced_column;
  }
  var tables = [];
  var columnsOf = {};
  for (var j = 0; j < columns.rows.length; j++) {
    var row = columns.rows[j];
    if (!columnsOf[row.table_name]) {
      columnsOf[row.table_name] = [];
      tables.push(row.table_name);
    }
    columnsOf[row.table_name].push({ name: row.column_name, ordinalPosition: Number(row.ordinal_position) });
  }
  var owned = [];
  for (var t = 0; t < tables.length; t++) {
    var table = tables[t];
    if (isPlatformTable(table)) { continue; }
    var resolved = resolveOwnerColumn(columnsOf[table]);
    if (!resolved || resolved.kind !== 'owner') { continue; }
    var target = referenced[table + '.' + resolved.column];
    if (target && target !== AUTH_USERS_TABLE + '.id') { continue; }
    owned.push({ table: table, column: resolved.column });
  }
  return owned;
}

// Each table is deleted from under its own savepoint, so one that refuses
// (another user's row still points at this user's, through a link without
// ON DELETE CASCADE) stops neither the other tables nor the account from being
// deleted. A refused table is retried once the rest are done — the blocker may
// have been this user's own row in another table; what is still refused stays
// as it always did, and the log names it.
async function deleteOwnedRows(client, userId) {
  var pending = await ownedRowLinks(client);
  while (pending.length > 0) {
    var refused = [];
    for (var i = 0; i < pending.length; i++) {
      var link = pending[i];
      await client.query('SAVEPOINT owned_rows');
      try {
        await client.query(
          'DELETE FROM ' + quoteIdentifier(link.table) + ' WHERE ' + quoteIdentifier(link.column) + ' = $1',
          [userId]
        );
        await client.query('RELEASE SAVEPOINT owned_rows');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT owned_rows');
        await client.query('RELEASE SAVEPOINT owned_rows');
        link.error = err && err.message ? err.message : String(err);
        refused.push(link);
      }
    }
    if (refused.length === pending.length) { break; }
    pending = refused;
  }
  for (var k = 0; k < pending.length; k++) {
    console.error('[account-delete] rows kept in ' + pending[k].table + ' (' + pending[k].column + '): ' + pending[k].error);
  }
}

// The password a request confirms the deletion with, or null when it names
// none. A request without one deletes as before; one with a password deletes
// only when it is the account's own (the editor's delete-account form asks for
// it).
function readRequestPassword(req) {
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object' || body.password === undefined || body.password === null) {
    return null;
  }
  return String(body.password);
}

// The sign-in check (utils/auth/hash-password.js verifyPassword): bcrypt over
// the SHA-256 of the password and AUTH_PEPPER. An account without a stored
// password (a social sign-in) matches no password.
function passwordMatches(password, storedHash) {
  if (!storedHash || password.length > 1000) { return false; }
  var bcrypt = require('bcryptjs');
  var crypto = require('crypto');
  var prepared = crypto.createHash('sha256').update(password + (process.env.AUTH_PEPPER || '')).digest('base64');
  try {
    return bcrypt.compareSync(prepared, String(storedHash));
  } catch (e) {
    return false;
  }
}

${generateFillTemplateFn()}

${generateLocalizedEmailCopyFn({
  fnName: 'resolveFarewellEmailCopy',
  subjectConst: 'EMAIL_SUBJECT',
  bodyConst: 'EMAIL_BODY_HTML',
  localizedConst: 'EMAIL_LOCALIZED',
})}

${generateProviderSendFunction(provider, {
  emailType: 'account-deleted',
  source: 'account-delete',
  sourceRef: 'api/account/delete-current',
  relativePrefix: '../../..',
  withoutRecipientDetails: true,
})}

// \`locale\` is the language of the page the deletion was requested from
// (see resolveRequestLocale); the email goes out in that language's copy.
async function sendFarewellEmail(toEmail, tokenValues, userId, locale) {
  if (!EMAIL_PROVIDER || !EMAIL_BODY_HTML || !toEmail) { return; }
  var apiKey = EMAIL_SECRET_ENV_NAME ? process.env[EMAIL_SECRET_ENV_NAME] : '';
  // Don't treat an unresolved deploy placeholder as a real credential.
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  if (!apiKey) { console.warn('[account-delete] farewell email skipped: credential not set'); return; }
  var from = EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!from) { console.warn('[account-delete] farewell email skipped: sender not configured'); return; }
  var copy = resolveFarewellEmailCopy(locale);
  var subject = fillSubjectTemplate(copy.subject, tokenValues);
  var html = fillTemplate(copy.body, tokenValues);
  await __sendProviderEmail({ from: from, fromName: EMAIL_FROM_NAME, to: toEmail, recordedTo: anonymisedEmailOf(userId), subject: subject, html: html, apiKey: apiKey, tokenValues: tokenValues, userId: userId });
}
${
  recordsDeletion
    ? generateAccountEventRecorder({ relativePrefix: '../../..', logTag: '[account-delete]' })
    : ''
}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Identify the user from the session — never trust a client-supplied id.
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  var userId = token && (token.id || token.sub);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  var requestPassword = readRequestPassword(req);
  var client = getClient();
  var userEmail = '';
  var userName = '';
  var userFound = false;
  var passwordRefused = false;
  var failed = false;
${
  recordsDeletion
    ? `  // The account as it was, for the user-deleted event.
  var deletedUser = null;
`
    : ''
}  // try/finally so the pg connection is ALWAYS closed — every early exit
  // (not-found, error) leaves via the finally, never leaking a connection.
  try {
    await client.connect();

    // Capture the email/name BEFORE deletion so the farewell email can still be sent.
    var userRes = await client.query('SELECT * FROM ' + AUTH_USERS_TABLE + ' WHERE id = $1', [userId]);
    if (userRes.rows.length) {
      userFound = true;
      userEmail = userRes.rows[0].email || '';
      userName = userRes.rows[0].name || '';
${recordsDeletion ? '      deletedUser = userRes.rows[0];\n' : ''}
      passwordRefused =
        requestPassword !== null && !passwordMatches(requestPassword, userRes.rows[0].password);
    }
    if (userFound && !passwordRefused) {
      var syntheticEmail = anonymisedEmailOf(userId);

      await client.query('BEGIN');
      try {
        for (var a = 0; a < ANONYMIZE_TABLES.length; a++) {
          await anonymizeUserRows(client, ANONYMIZE_TABLES[a], userId, syntheticEmail);
        }
        for (var d = 0; d < DELETE_TABLES.length; d++) {
          await deleteUserRows(client, DELETE_TABLES[d], userId);
        }
        await deleteOwnedRows(client, userId);
        await replaceEmailReferences(client, userEmail, syntheticEmail);
        await blankSentEmailsTo(client, userEmail);
        // password_reset_tokens has no user_id — it is keyed by the email string.
        await deleteRowsByEmail(client, 'password_reset_tokens', 'email', userEmail);
        await client.query('DELETE FROM ' + AUTH_USERS_TABLE + ' WHERE id = $1', [userId]);
        await client.query('COMMIT');
      } catch (txErr) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        throw txErr;
      }
    }
  } catch (err) {
    failed = true;
    console.error('[account-delete] failed:', err && err.message ? err.message : err);
  } finally {
    try { await client.end(); } catch (e) {}
  }

  if (failed) {
    return res.status(500).json({ error: 'Account deletion failed' });
  }
  if (!userFound) {
    return res.status(404).json({ error: 'Account not found' });
  }
  if (passwordRefused) {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  // Best-effort farewell email AFTER the successful commit (connection closed).
  try {
    var resolvedSiteName =
      SITE_NAME ||
      (req.headers && req.headers.host
        ? String(req.headers.host).replace(/^www\\./, '').split(':')[0]
        : '');
    await sendFarewellEmail(userEmail, {
      userName: userName || 'there',
      userEmail: userEmail,
      siteName: resolvedSiteName,
    }, userId, __emailLocale.resolveRequestLocale(req));
  } catch (emailErr) {
    console.error(
      '[account-delete] farewell email failed:',
      emailErr && emailErr.message ? emailErr.message : emailErr
    );
  }
${
  provider
    ? `  // Land the farewell email's ledger row before replying.
  if (typeof __sentEmailLog !== 'undefined') { await __sentEmailLog.settleSentEmailLog(); }
`
    : ''
}${
    recordsDeletion
      ? `  // The deletion is committed: the last thing the route does is record it.
  await recordAccountEvent('user-deleted', deletedUser, '', req);
`
      : ''
  }
  return res.status(200).json({ success: true });
};
`
}
