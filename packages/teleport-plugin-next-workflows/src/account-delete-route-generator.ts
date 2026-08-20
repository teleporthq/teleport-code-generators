/**
 * Generates the dedicated API route that backs the `account-delete-current`
 * workflow node: `pages/api/account/delete-current.js`.
 *
 * The client node calls this route, which:
 *   1. resolves the current user from the NextAuth session (never trusting a
 *      client-supplied id),
 *   2. runs a single DB transaction that detaches + anonymises business/legal
 *      records (orders, withdrawal requests) so tracking survives, deletes the
 *      user's personal data (reviews, cart, favourites, chat history) and the
 *      user row, and
 *   3. best-effort sends the farewell email (a failed send never fails the
 *      deletion).
 *
 * Every table statement is guarded by a runtime `information_schema` column
 * check, so the route is a no-op for feature tables a given project never
 * provisioned.
 */
import { generatePgClientCode } from './pg-client-code'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  transactionalEmailDependencies,
  generateProviderSendFunction,
  generateFillTemplateFn,
} from './transactional-email-code'

export interface AccountDeleteRouteOptions {
  // The auth identity table (resolved by the plugin). Defaults to `users`.
  authUsersTableName?: string
  // Farewell email — omit any to disable the send. `emailProvider` is the id
  // WITHOUT the `email-` prefix (e.g. `resend`). `emailSecretEnvName` is the env
  // var the credential lives under (resolved from the node's secret reference).
  emailProvider?: string | null
  fromEmail?: string
  emailSecretEnvName?: string | null
  emailSubject?: string
  emailBodyHtml?: string
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
const EMAIL_SECRET_ENV_NAME = ${JSON.stringify(options.emailSecretEnvName || '')};
const EMAIL_SUBJECT = ${JSON.stringify(options.emailSubject || 'Your account has been deleted')};
const EMAIL_BODY_HTML = ${JSON.stringify(options.emailBodyHtml || '')};

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
const ANONYMIZE_TABLES = ['teleport_orders', 'teleport_withdrawal_requests'];
const EMAIL_COLUMNS = ['billing_email', 'shipping_email', 'customer_email', 'email'];

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

${generateProviderSendFunction(provider)}

async function sendFarewellEmail(toEmail, tokenValues) {
  if (!EMAIL_PROVIDER || !EMAIL_BODY_HTML || !toEmail) { return; }
  var apiKey = EMAIL_SECRET_ENV_NAME ? process.env[EMAIL_SECRET_ENV_NAME] : '';
  // Don't treat an unresolved deploy placeholder as a real credential.
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  if (!apiKey) { console.warn('[account-delete] farewell email skipped: credential not set'); return; }
  var from = EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!from) { console.warn('[account-delete] farewell email skipped: sender not configured'); return; }
  var subject = fillTemplate(EMAIL_SUBJECT, tokenValues);
  var html = fillTemplate(EMAIL_BODY_HTML, tokenValues);
  await __sendProviderEmail({ from: from, to: toEmail, subject: subject, html: html, apiKey: apiKey });
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
    });
  } catch (emailErr) {
    console.error(
      '[account-delete] farewell email failed:',
      emailErr && emailErr.message ? emailErr.message : emailErr
    );
  }

  return res.status(200).json({ success: true });
};
`
}
