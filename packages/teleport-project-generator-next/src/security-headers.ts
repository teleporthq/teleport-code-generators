import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { addNextConfigHeaderRules, NextHeaderRule } from './next-config-headers'

/**
 * The response headers every page, asset and API route of a generated site
 * carries.
 *
 * No framing header (X-Frame-Options, CSP `frame-ancestors`): the editor's
 * live preview shows the generated app in an iframe from another origin, and
 * the template gallery frames published templates. No CSP either — inline
 * scripts, styled-jsx and third-party embeds would stop working.
 */
export const SECURITY_HEADER_RULES: NextHeaderRule[] = [
  {
    source: '/:path*',
    headers: [
      // A response is read only as the type it declares: a file served back
      // cannot run as a script or a page.
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      // Another site learns a visitor's origin, never the path and query they
      // came from (order ids, reset tokens, searches).
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Camera, microphone and location stay with the site itself, whose
      // workflows ask for them (speech input, media devices, the visitor's
      // location); no embedded frame can be handed them. Payment is left
      // alone: the provider frames on the store's own pages may ask for the
      // wallets.
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
      // Once seen over HTTPS, the host is HTTPS-only for two years. Browsers
      // ignore it over plain HTTP (a local `next dev`). Not `includeSubDomains`:
      // on a merchant's apex custom domain it would force every subdomain they
      // run elsewhere (a mail, a blog, a legacy shop) to HTTPS for two years.
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
    ],
  },
]

export class NextSecurityHeadersProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    addNextConfigHeaderRules(structure, SECURITY_HEADER_RULES)
    return structure
  }
}
