import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

/**
 * @deprecated The captcha provider script is no longer injected globally into
 * `_document.js`. It is now loaded per-page by the form ComponentPlugin
 * (`createNextFormSubmissionPlugin`), which injects a `next/script` <Script>
 * only into components that actually contain a form. This loads the captcha
 * (and, for reCAPTCHA v3/enterprise, its badge + background calls) only on
 * pages with forms instead of on every page.
 *
 * This class is kept as a no-op for backwards compatibility — it can be safely
 * removed from any project plugin pipeline.
 */
export class NextFormsCaptchaScriptPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }
}
