/**
 * Generates the dedicated API route that backs the `account-delete-current`
 * workflow node: `pages/api/account/delete-current.js`.
 *
 * The client node calls this route, which:
 *   1. resolves the current user from the NextAuth session (never trusting a
 *      client-supplied id),
 *   2. runs a single DB transaction that detaches + anonymises business/legal
 *      records (orders, withdrawal requests, bookings) so tracking survives,
 *      deletes the user's personal data (reviews, cart, favourites, chat
 *      history), deletes the rows the user owns in the project's own tables —
 *      the ones the AI made for the site, found through the shared owner-column
 *      vocabulary — and then the user row, and
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
];
// Business / legal records that must survive: the user link is nulled and any
// stored personal email is replaced with a synthetic, self-describing address.
const ANONYMIZE_TABLES = ['teleport_orders', 'teleport_withdrawal_requests', 'teleport_bookings'];
const EMAIL_COLUMNS = ['billing_email', 'shipping_email', 'customer_email', 'email'];
// A booking also names the customer and carries their phone; both are cleared.
const CLEARED_COLUMNS = { teleport_bookings: ['customer_name', 'customer_phone'] };

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

// Rows the user owns in the project's OWN tables — the ones the AI made for
// this site (saved items, requests, reviews …). Their link to the user is
// ON DELETE SET NULL, so they outlived the account with a blank owner, and the
// "My …" pages read "owner = me OR owner IS NULL": every other signed-in
// visitor saw them. Platform tables keep the explicit handling above —
// deleted, anonymised, or kept as the business's records.
const OWNER_COLUMN_NAMES = ${JSON.stringify(OwnerColumns.OWNER_COLUMN_NAMES)};
const OWNER_COLUMN_SUFFIX = ${JSON.stringify(OwnerColumns.OWNER_COLUMN_SUFFIX)};
const PLATFORM_TABLE_PREFIX = 'teleport_';
const PLATFORM_TABLES = [AUTH_USERS_TABLE, 'password_reset_tokens'];

function isPlatformTable(table) {
  return PLATFORM_TABLES.indexOf(table) !== -1 || table.indexOf(PLATFORM_TABLE_PREFIX) === 0;
}

// The rule the AI pipeline scopes a "My …" page by: one of the owner names, or
// the <entity>_user_id convention. Actor and audit links (assigned_to,
// updated_by …) name someone else's part in a row and are not owner columns —
// deleting on them would delete other people's rows.
function isOwnerColumn(column) {
  var name = String(column).toLowerCase();
  return OWNER_COLUMN_NAMES.indexOf(name) !== -1 || name.slice(-OWNER_COLUMN_SUFFIX.length) === OWNER_COLUMN_SUFFIX;
}

function quoteIdentifier(name) {
  return '"' + String(name).split('"').join('""') + '"';
}

// The (table, column) pairs through which the project's own tables name their
// owner: an owner-named column that references the users table — or references
// nothing, in older projects whose link was dropped. An owner-named column that
// references another table (account_id -> accounts) is a domain link and is
// left alone. Links are read from pg_constraint rather than information_schema:
// constraint names are only unique per table, so a join by name can pair the
// wrong tables.
async function ownedRowLinks(client) {
  var columns = await client.query(
    "SELECT c.table_name, c.column_name FROM information_schema.columns c" +
      " JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name" +
      " WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'"
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
  var owned = [];
  for (var j = 0; j < columns.rows.length; j++) {
    var table = columns.rows[j].table_name;
    var column = columns.rows[j].column_name;
    if (isPlatformTable(table) || !isOwnerColumn(column)) { continue; }
    var target = referenced[table + '.' + column];
    if (target && target !== AUTH_USERS_TABLE + '.id') { continue; }
    owned.push({ table: table, column: column });
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

// Invoices are a financial/tax record that must survive, but they store the
// customer's PII denormalised and link to the user only through order_id (no
// user_id). Scrub the PII in place, matching invoices whose order belongs to the
// user. MUST run BEFORE the orders row is anonymised (its user_id is still set).
var INVOICE_PII_NULL_COLUMNS = [
  'customer_name',
  'customer_address',
  'customer_city',
  'customer_state',
  'customer_zip',
  'customer_country',
  'customer_vat',
  'customer_phone',
];

async function anonymizeInvoices(client, ordersTable, invoicesTable, userId, syntheticEmail) {
  var invCols = await tableColumns(client, invoicesTable);
  if (invCols.indexOf('order_id') === -1) { return; }
  var orderCols = await tableColumns(client, ordersTable);
  if (orderCols.indexOf('user_id') === -1) { return; }
  var sets = [];
  var params = [];
  if (invCols.indexOf('customer_email') !== -1) {
    params.push(syntheticEmail);
    sets.push('customer_email = $' + params.length);
  }
  for (var i = 0; i < INVOICE_PII_NULL_COLUMNS.length; i++) {
    if (invCols.indexOf(INVOICE_PII_NULL_COLUMNS[i]) !== -1) {
      sets.push(INVOICE_PII_NULL_COLUMNS[i] + ' = NULL');
    }
  }
  if (sets.length === 0) { return; }
  params.push(userId);
  await client.query(
    'UPDATE ' + invoicesTable + ' SET ' + sets.join(', ') +
      ' WHERE order_id IN (SELECT id FROM ' + ordersTable + ' WHERE user_id = $' + params.length + ')',
    params
  );
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
  var subject = fillTemplate(copy.subject, tokenValues);
  var html = fillTemplate(copy.body, tokenValues);
  await __sendProviderEmail({ from: from, fromName: EMAIL_FROM_NAME, to: toEmail, subject: subject, html: html, apiKey: apiKey, tokenValues: tokenValues, userId: userId });
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

  var client = getClient();
  var userEmail = '';
  var userName = '';
  var userFound = false;
  var failed = false;
  // try/finally so the pg connection is ALWAYS closed — every early exit
  // (not-found, error) leaves via the finally, never leaking a connection.
  try {
    await client.connect();

    // Capture the email/name BEFORE deletion so the farewell email can still be sent.
    var userRes = await client.query('SELECT * FROM ' + AUTH_USERS_TABLE + ' WHERE id = $1', [userId]);
    if (userRes.rows.length) {
      userFound = true;
      userEmail = userRes.rows[0].email || '';
      userName = userRes.rows[0].name || '';

      var syntheticEmail = String(DELETED_EMAIL_PATTERN).split('{{userId}}').join(String(userId));

      await client.query('BEGIN');
      try {
        // Scrub invoice PII FIRST — invoices link to the user only through
        // order_id, so this must run while the orders row still carries user_id.
        await anonymizeInvoices(client, 'teleport_orders', 'teleport_invoices', userId, syntheticEmail);
        for (var a = 0; a < ANONYMIZE_TABLES.length; a++) {
          await anonymizeUserRows(client, ANONYMIZE_TABLES[a], userId, syntheticEmail);
        }
        for (var d = 0; d < DELETE_TABLES.length; d++) {
          await deleteUserRows(client, DELETE_TABLES[d], userId);
        }
        await deleteOwnedRows(client, userId);
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
}
  return res.status(200).json({ success: true });
};
`
}
