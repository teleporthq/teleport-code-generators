/**
 * The password-reset routes every project with password sign-in gets:
 * `pages/api/auth/forgot-password.js` and `pages/api/auth/reset-password.js`.
 *
 * Like the account-deletion route, each makes the whole security decision on
 * the server, in one place. The reset link's token is minted here with a
 * CSPRNG and never leaves the server except in the email to the account's own
 * address; only its SHA-256 is stored, bound to the account id, for 30
 * minutes, and the reset route spends it in the same statement that sets the
 * password. Nothing a browser sends can name a token, an account or the email
 * a link goes to — the workflow that used to compose them from browser-relayed
 * context let anyone set any user's password.
 *
 * The forgot route answers the same, in about the same time, whether the
 * address has an account or not, and writes nothing for an address without
 * one. The email goes out through the provider and template the project's
 * `account-request-password-reset` node configures (the same baked-config
 * pattern as the sign-up welcome email).
 */
import {
  FileType,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLAuthentication,
  UIDLLocalizedEmailTemplates,
} from '@teleporthq/teleport-types'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  generateEmailLocaleRequire,
  generateFillTemplateFn,
  generateLocalizedEmailCopyFn,
  generateProviderSendFunction,
  readLocalizedEmailTemplates,
  transactionalEmailDependencies,
} from './transactional-email-code'
import { CONFIGURED_NEXTAUTH_URL_EXPRESSION } from './configured-nextauth-url'
import { securityRuntimeSpecifier } from './security-runtime/security-runtime-code'
import { ensureEmailLocaleModule } from './email-locale'
import { ensureSentEmailLogModule } from './sent-email-log'

export const FORGOT_PASSWORD_ROUTE_NAME = 'forgot-password'
export const RESET_PASSWORD_ROUTE_NAME = 'reset-password'

/** How long an emailed reset link works. */
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 1800
/** Reset links one address can be sent per hour, and forgot requests per visitor per hour. */
export const FORGOT_PASSWORD_RECIPIENT_LIMIT = 3
export const FORGOT_PASSWORD_VISITOR_LIMIT = 10
/** Reset attempts (and link checks) per visitor per 15 minutes. */
export const RESET_PASSWORD_VISITOR_LIMIT = 20

export const DEFAULT_RESET_PAGE_PATH = '/reset-password'

/** The same answer for every well-formed request, whatever the address. */
export const FORGOT_PASSWORD_ANSWER =
  'If an account exists for that email, we sent it a link to reset the password.'

/**
 * The sessionStorage key the reset page reads the link's token from (mirrored
 * in teleport-gui `RESET_TOKEN_STORAGE_KEY`). The published site's first head
 * script (teleport-project-generator-next `address-key-keeper.ts`) moves the
 * token there, out of the address, before any other script of the page runs:
 * an analytics or ads tag reads `location.href`, and the token is the account
 * for 30 minutes.
 */
export const RESET_TOKEN_STORAGE_KEY = 'tq-reset-token'

/**
 * Whether the project's reset page reads the token the keeper keeps (its
 * workflows name RESET_TOKEN_STORAGE_KEY). Only then does the emailed link
 * carry the token in its fragment, and does the keeper watch the reset page: a
 * site exported by an editor that still reads `?token=` keeps its links as
 * they were.
 */
export const readsKeptResetToken = (uidl: ProjectUIDL): boolean => {
  const auth = uidl.authentication
  if (!auth?.enabled || !auth.passwordAuthEnabled || !uidl.workflows) {
    return false
  }
  try {
    return JSON.stringify(uidl.workflows).includes(RESET_TOKEN_STORAGE_KEY)
  } catch (error) {
    return false
  }
}

/** The reset page paths the keeper watches: the page the reset email links to. */
export const resetTokenKeeperPagePaths = (uidl: ProjectUIDL): string[] => {
  if (!readsKeptResetToken(uidl)) {
    return []
  }
  const config =
    collectWorkflowNodeConfigs(uidl.workflows, REQUEST_PASSWORD_RESET_NODE_TYPE)[0] || {}
  return [resolveResetPagePath(config.resetPagePath)]
}

/**
 * The page this project's reset links open, and whether they carry the token
 * in the fragment: the forgot-password link, and the set-password link a
 * sign-up mails to an address the site knows without a password.
 */
export const resetLinkOf = (
  uidl: ProjectUIDL
): { resetPagePath: string; tokenInFragment: boolean } => {
  const config =
    collectWorkflowNodeConfigs(uidl.workflows, REQUEST_PASSWORD_RESET_NODE_TYPE)[0] || {}
  return {
    resetPagePath: resolveResetPagePath(config.resetPagePath),
    tokenInFragment: readsKeptResetToken(uidl),
  }
}

/**
 * Who sends this project's reset email (the forgot-password node's provider id
 * without `email-`, sender and credential env var). The sign-up's emails to an
 * address the site already knows fall back to it.
 */
export const resetEmailSenderOf = (
  uidl: ProjectUIDL
): { emailProvider: string; fromEmail: string; emailSecretEnvName: string } => {
  const config =
    collectWorkflowNodeConfigs(uidl.workflows, REQUEST_PASSWORD_RESET_NODE_TYPE)[0] || {}
  const providerNodeType = typeof config.emailProvider === 'string' ? config.emailProvider : ''
  return {
    emailProvider: providerNodeType.startsWith('email-')
      ? providerNodeType.slice('email-'.length)
      : '',
    fromEmail: typeof config.from === 'string' ? config.from : '',
    emailSecretEnvName: secretEnvNameOf(config.apiKey) || secretEnvNameOf(config.serverToken),
  }
}

export interface ForgotPasswordRouteOptions {
  /**
   * The link carries the token in its fragment (`#token=`), which never
   * reaches a server, a Referer or the page's address once the keeper ran;
   * otherwise in its query, for a reset page that still reads it there.
   */
  tokenInFragment?: boolean
  /** The reset page the emailed link opens (a same-site path). */
  resetPagePath?: string
  /** The provider id WITHOUT the `email-` prefix (e.g. `resend`). */
  emailProvider?: string | null
  fromEmail?: string
  /** The env var the provider credential lives under. */
  emailSecretEnvName?: string | null
  emailSubject?: string
  emailBodyHtml?: string
  localizedTemplates?: UIDLLocalizedEmailTemplates
  siteName?: string
}

/**
 * The reset page path a link may point at: a same-site path without a query
 * or fragment, else the default reset page. Never taken from a request — a
 * link to another page of the site (an open redirect, a page with third-party
 * scripts) would hand the token to someone else.
 */
export const resolveResetPagePath = (value: unknown): string => {
  const path = typeof value === 'string' ? value.trim() : ''
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\?#\s"'<>]/.test(path) ||
    path.indexOf('..') !== -1
  ) {
    return DEFAULT_RESET_PAGE_PATH
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export const TRUSTED_ORIGIN_CODE = `function isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

// The origin the emailed link opens. On Vercel the request's host is a domain
// Vercel routed to this deployment; anywhere else the Host header is whatever
// the caller sent — a forged one would mail the victim a link to the attacker's
// site — so the configured NEXTAUTH_URL wins (read as the deployment set it,
// before the auth route rewrites it per request).
function trustedOrigin(req) {
  var headers = (req && req.headers) || {};
  var host = String(headers.host || '');
  var proto = String(headers['x-forwarded-proto'] || (isLoopbackHost(host) ? 'http' : 'https')).split(',')[0].trim();
  var requestOrigin = proto + '://' + host;
  if (process.env.VERCEL && host) return requestOrigin;
  var configured = String(${CONFIGURED_NEXTAUTH_URL_EXPRESSION} || '').trim();
  var origin = '';
  try { origin = configured ? new URL(configured).origin : ''; } catch (e) { origin = ''; }
  if (!origin) return isLoopbackHost(host) ? requestOrigin : 'http://localhost:3000';
  if (isLoopbackHost(host) && isLoopbackHost(new URL(origin).host)) return requestOrigin;
  return origin;
}`

const READ_BODY_CODE = `function readBody(req) {
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  return body && typeof body === 'object' ? body : {};
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}`

export const generateForgotPasswordRoute = (options: ForgotPasswordRouteOptions = {}): string => {
  const provider =
    options.emailProvider && SUPPORTED_EMAIL_PROVIDERS.has(options.emailProvider)
      ? options.emailProvider
      : null
  const resetPagePath = resolveResetPagePath(options.resetPagePath)

  return `var crypto = require('crypto');
var __security = require('${securityRuntimeSpecifier('../../..')}');
var authUtils = require('../../../utils/auth/auth-options');
${generateEmailLocaleRequire('../../..')}
${
  provider
    ? "var __sentEmailLog = require('../../../utils/email/sent-email-log');"
    : 'var __sentEmailLog = null;'
}

var RESET_PAGE_PATH = ${JSON.stringify(resetPagePath)};
// Where the link carries the token (see ForgotPasswordRouteOptions.tokenInFragment).
var TOKEN_LINK_PREFIX = ${JSON.stringify(options.tokenInFragment ? '#token=' : '?token=')};
var TOKEN_TTL_SECONDS = ${PASSWORD_RESET_TOKEN_TTL_SECONDS};
// Every answer takes at least this long, so the time does not tell an address
// with an account (a link is stored and mailed) from one without.
var MIN_RESPONSE_MS = 1200;
var ANSWER = { success: true, message: ${JSON.stringify(FORGOT_PASSWORD_ANSWER)} };

var EMAIL_PROVIDER = ${JSON.stringify(provider)};
var EMAIL_FROM = ${JSON.stringify(options.fromEmail || '')};
var EMAIL_SECRET_ENV_NAME = ${JSON.stringify(options.emailSecretEnvName || '')};
var EMAIL_SUBJECT = ${JSON.stringify(options.emailSubject || 'Reset your password')};
var EMAIL_BODY_HTML = ${JSON.stringify(options.emailBodyHtml || '')};
var EMAIL_LOCALIZED = ${JSON.stringify(options.localizedTemplates || {})};
var SITE_NAME = ${JSON.stringify(options.siteName || '')};

${READ_BODY_CODE}

${TRUSTED_ORIGIN_CODE}

${generateFillTemplateFn()}

${generateLocalizedEmailCopyFn({
  fnName: 'resolveResetEmailCopy',
  subjectConst: 'EMAIL_SUBJECT',
  bodyConst: 'EMAIL_BODY_HTML',
  localizedConst: 'EMAIL_LOCALIZED',
})}

${generateProviderSendFunction(provider)}

function waitUntilElapsed(startedAt, ms) {
  var left = ms - (Date.now() - startedAt);
  return left > 0 ? new Promise(function (resolve) { setTimeout(resolve, left); }) : Promise.resolve();
}

// The token, wherever it appears, for what the sent-email log keeps: whoever
// can read the log must not be able to set the password with it.
function hideToken(text, token) {
  return String(text == null ? '' : text).split(token).join('[hidden]');
}

async function sendResetEmail(user, resetUrl, token, locale) {
  if (!EMAIL_PROVIDER || !EMAIL_BODY_HTML) {
    console.warn('[forgot-password] reset link not sent: no email provider or email template is configured');
    return;
  }
  var apiKey = EMAIL_SECRET_ENV_NAME ? process.env[EMAIL_SECRET_ENV_NAME] : '';
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  if (!apiKey) { console.warn('[forgot-password] reset link not sent: the email credential is not set'); return; }
  var from = EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!from) { console.warn('[forgot-password] reset link not sent: no sender is configured'); return; }
  var to = String(user.email);
  var values = {
    resetUrl: resetUrl,
    recipientEmail: to,
    userName: user.name || 'there',
    siteName: SITE_NAME,
  };
  var copy = resolveResetEmailCopy(locale);
  var subject = fillSubjectTemplate(copy.subject, values);
  var html = fillTemplate(copy.body, values);
  var failure = null;
  try {
    await __sendProviderEmail({ from: from, to: to, subject: subject, html: html, apiKey: apiKey });
  } catch (err) {
    failure = err;
  }
  if (__sentEmailLog) {
    __sentEmailLog.recordSentEmail({
      emailType: 'forgot-password',
      audience: 'customer',
      to: to,
      from: from,
      subject: hideToken(subject, token),
      html: hideToken(html, token),
      payload: { resetUrl: hideToken(resetUrl, token), recipientEmail: to },
      provider: EMAIL_PROVIDER,
      status: failure ? 'failed' : 'sent',
      error: failure ? (failure.message || String(failure)) : null,
      source: 'forgot-password',
      sourceRef: 'api/auth/forgot-password',
      userId: user.id,
    });
    await __sentEmailLog.settleSentEmailLog();
  }
  if (failure) { throw failure; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await __security.rateLimitRequest(req, res, { scope: 'auth-forgot-password', limit: ${FORGOT_PASSWORD_VISITOR_LIMIT}, windowSeconds: 3600 }))) {
    return;
  }
  var startedAt = Date.now();
  var body = readBody(req);
  var email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  var user = null;
  try {
    user = await authUtils.findUserByEmail(email);
  } catch (err) {
    return __security.sendClientError(res, 503, 'We could not reach the account service. Please try again in a moment.', err);
  }

  try {
    // Counted for every address, with an account or without, so neither the
    // answer nor its timing differs.
    var recipient = await __security.rateLimit({
      key: 'auth-forgot-recipient:' + email.toLowerCase(),
      limit: ${FORGOT_PASSWORD_RECIPIENT_LIMIT},
      windowSeconds: 3600,
    });
    var userId = user ? (user.id != null ? user.id : user._id) : null;
    if (user && userId != null && user.email && !recipient.allowed) {
      console.warn('[forgot-password] reset link not sent: this address was sent ${FORGOT_PASSWORD_RECIPIENT_LIMIT} in the last hour');
    } else if (user && userId != null && user.email) {
      if (!authUtils.PASSWORD_RESET_SUPPORTED) {
        console.warn('[forgot-password] reset link not sent: password reset needs a Postgres user store');
      } else {
        var token = crypto.randomBytes(32).toString('hex');
        await authUtils.storePasswordReset(userId, sha256(token), TOKEN_TTL_SECONDS);
        var resetUrl = trustedOrigin(req) + RESET_PAGE_PATH + TOKEN_LINK_PREFIX + token;
        await sendResetEmail(user, resetUrl, token, __emailLocale.resolveRequestLocale(req));
      }
    }
  } catch (err) {
    console.error('[forgot-password] could not send a reset link:', err && err.message ? err.message : err);
  }

  await waitUntilElapsed(startedAt, MIN_RESPONSE_MS);
  return res.status(200).json(ANSWER);
};
`
}

export const generateResetPasswordRoute = (): string => `var crypto = require('crypto');
var __security = require('${securityRuntimeSpecifier('../../..')}');
var hashPassword = require('../../../utils/auth/hash-password');
var authUtils = require('../../../utils/auth/auth-options');

// What forgot-password mints: 32 random bytes, hex.
var TOKEN_PATTERN = /^[0-9a-f]{64}$/;
var NOT_VALID = { valid: false, changed: false };

${READ_BODY_CODE}

// { token, password } sets the password when the link is live, spending it;
// { token, checkOnly: true } only says whether it is live. A link that is not
// (expired, spent, superseded, from before these links, or no link at all) is
// { valid: false, changed: false }.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await __security.rateLimitRequest(req, res, { scope: 'auth-reset-password', limit: ${RESET_PASSWORD_VISITOR_LIMIT}, windowSeconds: 900 }))) {
    return;
  }
  var body = readBody(req);
  var token = typeof body.token === 'string' ? body.token.trim().toLowerCase() : '';
  if (!TOKEN_PATTERN.test(token)) {
    return res.status(200).json(NOT_VALID);
  }
  var tokenHash = sha256(token);

  if (body.checkOnly === true) {
    try {
      var live = await authUtils.passwordResetIsLive(tokenHash);
      return res.status(200).json({ valid: live === true, changed: false });
    } catch (err) {
      return __security.sendClientError(res, 503, 'We could not check the reset link. Please try again in a moment.', err);
    }
  }

  var password = typeof body.password === 'string' ? body.password : '';
  var policyError = hashPassword.passwordPolicyError(password);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }
  try {
    var account = await authUtils.consumePasswordReset(tokenHash, hashPassword(password));
    if (!account) {
      return res.status(200).json(NOT_VALID);
    }
    // Every session stamped with the old password ends (session-revocation).
    return res.status(200).json({ valid: true, changed: true });
  } catch (err) {
    return __security.sendClientError(res, 503, 'We could not reset the password. Please try again in a moment.', err);
  }
};
`

/** The env var holding the project's own password pepper (provisioned at deploy). */
export const AUTH_PEPPER_SECRET_ENV = 'AUTH_PEPPER_SECRET'

/** The node type whose config carries the reset email (provider, sender, template, page). */
export const REQUEST_PASSWORD_RESET_NODE_TYPE = 'account-request-password-reset'

/** Every config of a node type across the project's workflows and custom nodes. */
export const collectWorkflowNodeConfigs = (
  workflows: { workflows?: unknown; customNodes?: unknown } | undefined,
  nodeType: string
): Array<Record<string, unknown>> => {
  const configs: Array<Record<string, unknown>> = []
  for (const group of [workflows?.workflows, workflows?.customNodes]) {
    if (!group || typeof group !== 'object') {
      continue
    }
    for (const entry of Object.values(group as Record<string, { nodes?: unknown }>)) {
      const nodes = entry && Array.isArray(entry.nodes) ? entry.nodes : []
      for (const node of nodes as Array<{ type?: string; config?: Record<string, unknown> }>) {
        if (node && node.type === nodeType) {
          configs.push(node.config || {})
        }
      }
    }
  }
  return configs
}

const secretEnvNameOf = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.startsWith('teleporthq.secrets.')
      ? value.slice('teleporthq.secrets.'.length)
      : value
  }
  const ref = value as { content?: { referenceType?: string; id?: string } } | null
  return ref && ref.content && ref.content.referenceType === 'secret' && ref.content.id
    ? ref.content.id
    : ''
}

/**
 * What every project with password sign-in gets beside its sign-in and sign-up
 * routes: the forgot / reset password routes (the reset email baked from the
 * first `account-request-password-reset` node's config) and an
 * `AUTH_PEPPER_SECRET=` line in `.env`, which the
 * deploy step fills with the project's own pepper (declared empty, never
 * random: a pepper that changed with every generation would lock every user
 * out, while an empty one means the old pepper — see utils/auth/hash-password).
 */
export const emitPasswordAuthFiles = (
  structure: ProjectPluginStructure,
  auth: UIDLAuthentication
): void => {
  const { files, dependencies, uidl } = structure
  if (!auth.enabled || !auth.passwordAuthEnabled) {
    return
  }

  const config =
    collectWorkflowNodeConfigs(uidl.workflows, REQUEST_PASSWORD_RESET_NODE_TYPE)[0] || {}
  const sender = resetEmailSenderOf(uidl)
  const emailProvider = sender.emailProvider

  ensureEmailLocaleModule(structure)
  files.set('auth-forgot-password-route', {
    path: ['pages', 'api', 'auth'],
    files: [
      {
        name: FORGOT_PASSWORD_ROUTE_NAME,
        fileType: FileType.JS,
        content: generateForgotPasswordRoute({
          ...resetLinkOf(uidl),
          ...sender,
          emailSubject: typeof config.subject === 'string' ? config.subject : '',
          emailBodyHtml: typeof config.body === 'string' ? config.body : '',
          localizedTemplates: readLocalizedEmailTemplates(config.localizedTemplates),
          siteName: uidl.name || '',
        }),
      },
    ],
  })
  files.set('auth-reset-password-route', {
    path: ['pages', 'api', 'auth'],
    files: [
      {
        name: RESET_PASSWORD_ROUTE_NAME,
        fileType: FileType.JS,
        content: generateResetPasswordRoute(),
      },
    ],
  })

  const providerDeps = transactionalEmailDependencies(emailProvider)
  for (const [pkg, version] of Object.entries(providerDeps)) {
    if (!dependencies[pkg]) {
      dependencies[pkg] = version
    }
  }
  if (Object.keys(providerDeps).length > 0) {
    ensureSentEmailLogModule(structure)
  }

  if (uidl.globals) {
    uidl.globals.env = uidl.globals.env || {}
    if (typeof uidl.globals.env[AUTH_PEPPER_SECRET_ENV] !== 'string') {
      uidl.globals.env[AUTH_PEPPER_SECRET_ENV] = ''
    }
  }
}
