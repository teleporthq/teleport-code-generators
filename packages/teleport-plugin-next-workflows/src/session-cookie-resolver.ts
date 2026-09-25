import { SessionCookieResolver } from '@teleporthq/teleport-shared'

/**
 * The session-cookie resolver lives in teleport-shared so the per-table data
 * routes (teleport-plugin-next-data-source) decode a session exactly the way
 * the workflow routes do. This module keeps the plugin's public export path.
 */
export const SESSION_TOKEN_RESOLVER_FN = SessionCookieResolver.SESSION_TOKEN_RESOLVER_FN
export const generateSessionTokenResolverCode =
  SessionCookieResolver.generateSessionTokenResolverCode
export const generateCommonJsSessionTokenResolverCode =
  SessionCookieResolver.generateCommonJsSessionTokenResolverCode
