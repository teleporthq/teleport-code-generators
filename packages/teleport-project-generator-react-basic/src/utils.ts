import {
  GeneratedFile,
  GeneratedFolder,
  TemplateDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { injectFilesToPath } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import {
  DEFAULT_SRC_FILES_PATH,
  DEFAULT_COMPONENT_FILES_PATH,
  DEFAULT_PAGE_FILES_PATH,
  DEFAULT_STATIC_FILES_PATH,
} from './constants'

export const buildFolderStructure = (
  files: Record<string, GeneratedFile[]>,
  template: TemplateDefinition = {}
): GeneratedFolder => {
  const { componentFiles, distFiles, pageFiles, srcFiles, staticFiles } = files
  template.meta = template.meta || {}

  let { templateFolder } = template
  templateFolder = injectFilesToPath(templateFolder, null, distFiles)

  const srcFilesPath = template.meta.srcFilesPath || DEFAULT_SRC_FILES_PATH
  templateFolder = injectFilesToPath(templateFolder, srcFilesPath, srcFiles)

  const componentFilesPath = template.meta.componentsPath || DEFAULT_COMPONENT_FILES_PATH
  templateFolder = injectFilesToPath(templateFolder, componentFilesPath, componentFiles)

  const pageFilesPath = template.meta.pagesPath || DEFAULT_PAGE_FILES_PATH
  templateFolder = injectFilesToPath(templateFolder, pageFilesPath, pageFiles)

  const staticFilesPath = template.meta.staticFilesPath || DEFAULT_STATIC_FILES_PATH
  templateFolder = injectFilesToPath(templateFolder, staticFilesPath, staticFiles)

  return templateFolder
}
