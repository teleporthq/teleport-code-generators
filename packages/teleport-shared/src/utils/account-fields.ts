/**
 * An account column that grants something — a role, an admin or staff flag, a
 * verified email, credit, a plan or an entitlement — matched on its name with
 * case and separators dropped (`is_admin`, `isAdmin`, `Email-Verified`). Only
 * the server (staff, or the app's own jobs) sets one on an account; nothing a
 * visitor fills in writes one.
 *
 * One rule for the generated sign-up route and sign-up node, the data API's
 * account-table net and the editor's account forms. It is an ACCOUNT rule:
 * `plan`, `tier`, `balance` or `credits` are ordinary columns of other tables.
 */
export const PRIVILEGED_ACCOUNT_FIELD_PATTERN =
  /^(role.*|isadmin|admin|isstaff|issuperuser|emailverified|verified|credits|balance|plan|tier|subscription.*|entitlement.*)$/

/** The name as the rule compares it: lower case, letters and digits only. */
export const normalizeAccountFieldName = (key: unknown): string =>
  String(key == null ? '' : key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const isPrivilegedAccountField = (key: unknown): boolean =>
  PRIVILEGED_ACCOUNT_FIELD_PATTERN.test(normalizeAccountFieldName(key))

/** The same rule for generated server code: `function <functionName>(key)`. */
export const generatePrivilegedAccountFieldCode = (
  functionName: string
): string => `function ${functionName}(key) {
  return ${PRIVILEGED_ACCOUNT_FIELD_PATTERN.toString()}.test(
    String(key == null ? '' : key).toLowerCase().replace(/[^a-z0-9]/g, '')
  );
}`
