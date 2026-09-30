// The shared workflow runtime, as every file that inlines node handlers binds
// it before the first handler (see `workflow-utils-alias.ts`). Declared here
// so the handler sources type-check against it; only the helpers a handler
// actually calls are listed.
declare const __workflowUtils: {
  /**
   * The href a navigation should use so the visitor stays in `locale` (a
   * site-relative page path gets the "/<locale>" prefix Next.js serves the
   * non-default languages under; everything else passes through untouched).
   */
  localizeHref(href: string, locale: unknown): string
  /**
   * Where a visitor lands once signed in or up: the same-site `callbackUrl`
   * of the page they are on, else the home page — localized to `locale`.
   */
  signedInDestination(locale: unknown): string
}
