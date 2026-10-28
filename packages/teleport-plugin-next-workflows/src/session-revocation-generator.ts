/**
 * `utils/auth/session-revocation.js`: the one check that ends a session once
 * the account's credentials change, and that hands every server file the
 * account's stored email and role. Emitted for every project with
 * authentication.
 *
 * A session token carries a stamp of the account's password hash (and of its
 * `session_version` column, when the `users` table has one), taken when it was
 * issued. `liveSessionToken` reads the account by the token's id (the key every
 * consumer acts on): a deleted account, a password reset or change, or a bumped
 * `session_version` ("sign out everywhere") ends every token stamped before,
 * and a live token comes back with the row's email and role, so a demotion
 * counts on the next request. A store that cannot be read (an error, or no
 * lookup by id) answers no session: the check fails closed. The shared session
 * reader (`__tqSessionToken`) runs it for every server file; the NextAuth `jwt`
 * callback compares the same stamp on each `/api/auth/session`.
 */

import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { SessionCookieResolver } from '@teleporthq/teleport-shared'

/**
 * The token claim that carries the stamp. Never copied onto `session.user`.
 * One value with the shared session reader (`__tqSessionToken`), which runs
 * this module's check for every consumer.
 */
export const SESSION_STAMP_KEY = SessionCookieResolver.SESSION_STAMP_KEY

export const SESSION_REVOCATION_FILE_NAME = 'session-revocation'

/**
 * How long one server instance trusts its last look at an account: a password
 * change, a deletion or a demotion counts on every instance within this.
 */
export const SESSION_CHECK_INTERVAL_MS = 10000

/**
 * Writes `utils/auth/session-revocation.js` for every project with
 * authentication: the shared session reader requires it from every server
 * file (an OAuth-only project's sessions are never stamped, so its check
 * always passes).
 */
export const ensureSessionRevocationModule = (structure: ProjectPluginStructure): void => {
  if (structure.files.has('auth-session-revocation')) {
    return
  }
  structure.files.set('auth-session-revocation', {
    path: ['utils', 'auth'],
    files: [
      {
        name: SESSION_REVOCATION_FILE_NAME,
        fileType: FileType.JS,
        content: generateSessionRevocationFile(),
      },
    ],
  })
}

export const generateSessionRevocationFile = (): string => `'use strict';

// GENERATED — see generateSessionRevocationFile in
// @teleporthq/teleport-plugin-next-workflows/src/session-revocation-generator.ts.
//
// A session ends when the account's password changes (a reset, a change), its
// session_version column, when the users table has one, moves ("sign out
// everywhere"), or the account is gone. The token carries a stamp of both from
// when it was issued; the account, read by the token's id, is compared with it
// here. The shared session reader (__tqSessionToken) runs this for every server
// file, and hands out the token with the account's stored email and role, so a
// demotion counts at once.

var crypto = require('crypto');
var __security = require('../security-runtime');

var SESSION_STAMP_KEY = '${SESSION_STAMP_KEY}';
// How long one server instance trusts its last look at an account.
var CHECK_INTERVAL_MS = ${SESSION_CHECK_INTERVAL_MS};
var CACHE_MAX_ENTRIES = 5000;
// What the token takes from the stored account.
var ACCOUNT_FIELDS = ['email', 'role', 'roleName', 'roles'];
var __checked = new Map();

// A keyed digest of what the session depends on: the password hash and the
// optional session_version. null without the app secret (no token can be
// issued or decoded without it either).
function credentialStamp(row) {
  var secret = process.env.NEXTAUTH_SECRET;
  if (!row || typeof row !== 'object' || !secret) {
    return null;
  }
  var material =
    'session-stamp|v1|' +
    String(row.password == null ? '' : row.password) +
    '|' +
    String(row.session_version == null ? '' : row.session_version);
  return crypto.createHmac('sha256', String(secret)).update(material).digest('hex').slice(0, 32);
}

// 'unstamped' (a token issued before stamps, or with no account of its own),
// 'current', or 'revoked' — for the token's account as stored now (null: the
// account is gone, which ends the session too).
function stampVerdict(token, row) {
  if (!token || typeof token !== 'object' || typeof token[SESSION_STAMP_KEY] !== 'string') {
    return 'unstamped';
  }
  if (!row) {
    return 'revoked';
  }
  var stamp = credentialStamp(row);
  if (!stamp) {
    return 'current';
  }
  return __security.safeEqual(stamp, token[SESSION_STAMP_KEY]) ? 'current' : 'revoked';
}

function accountOf(row) {
  var account = {};
  for (var i = 0; i < ACCOUNT_FIELDS.length; i++) {
    if (row[ACCOUNT_FIELDS[i]] !== undefined) {
      account[ACCOUNT_FIELDS[i]] = row[ACCOUNT_FIELDS[i]];
    }
  }
  return account;
}

function withAccount(token, account) {
  var live = Object.assign({}, token);
  var keys = Object.keys(account);
  for (var i = 0; i < keys.length; i++) {
    live[keys[i]] = account[keys[i]];
  }
  return live;
}

function remember(key, account, now) {
  if (__checked.size >= CACHE_MAX_ENTRIES) {
    __checked.delete(__checked.keys().next().value);
  }
  __checked.set(key, { account: account, at: now });
}

// The token as it still counts — carrying the account's stored email and role —
// or null when its account changed its credentials since the token was
// stamped, or is gone. An unstamped token is returned as it is. A store that
// cannot be read REJECTS (and nothing is cached): the reader then counts no
// session, never the stale one.
async function liveSessionToken(token) {
  if (!token || typeof token !== 'object' || typeof token[SESSION_STAMP_KEY] !== 'string') {
    return token || null;
  }
  var id = token.id != null ? token.id : token.sub;
  if (id == null || String(id) === '') {
    return null;
  }
  var key = String(id) + '|' + token[SESSION_STAMP_KEY];
  var now = Date.now();
  var seen = __checked.get(key);
  if (seen && now - seen.at >= 0 && now - seen.at < CHECK_INTERVAL_MS) {
    return seen.account ? withAccount(token, seen.account) : null;
  }
  var authOptions = require('./auth-options');
  if (!authOptions || typeof authOptions.findUserById !== 'function') {
    throw new Error('The account store cannot be read by id');
  }
  var row = await authOptions.findUserById(String(id));
  var account = stampVerdict(token, row || null) === 'current' ? accountOf(row) : null;
  remember(key, account, now);
  return account ? withAccount(token, account) : null;
}

module.exports = {
  SESSION_STAMP_KEY: SESSION_STAMP_KEY,
  credentialStamp: credentialStamp,
  stampVerdict: stampVerdict,
  liveSessionToken: liveSessionToken,
};
`
