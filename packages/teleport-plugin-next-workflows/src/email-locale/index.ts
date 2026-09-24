import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { generateEmailLocaleModuleCode } from './email-locale-code'
import {
  EMAIL_LOCALE_FILE_KEY,
  EMAIL_LOCALE_FILE_NAME,
  EMAIL_LOCALE_PATH,
  resolveEmailLocaleConfig,
} from './email-locale-scope'

export {
  EMAIL_LOCALE_CONFIG_KEY,
  EMAIL_LOCALE_HEADER,
  EmailLocaleConfig,
  LOCALIZED_TEMPLATES_CONFIG_KEY,
  WORKFLOW_CONTEXT_LOCALE_KEY,
  resolveEmailLocaleConfig,
} from './email-locale-scope'
export {
  generateEmailLocaleHelpersCode,
  generateEmailLocaleModuleCode,
  generateWorkflowLocaleHelpersCode,
} from './email-locale-code'

/**
 * Writes `utils/email/email-locale.js` into the project, once. Like the
 * sent-email ledger, every emitter of a send path that lives outside the
 * workflow runtime calls this right where it emits the `require`, so the file
 * exists exactly when something needs it, whichever plugin ran first.
 */
export const ensureEmailLocaleModule = (structure: ProjectPluginStructure): void => {
  const { files, uidl } = structure
  if (files.has(EMAIL_LOCALE_FILE_KEY)) {
    return
  }

  files.set(EMAIL_LOCALE_FILE_KEY, {
    path: EMAIL_LOCALE_PATH,
    files: [
      {
        name: EMAIL_LOCALE_FILE_NAME,
        fileType: FileType.JS,
        content: generateEmailLocaleModuleCode(resolveEmailLocaleConfig(uidl)),
      },
    ],
  })
}
