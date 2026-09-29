import {
  FileType,
  GeneratedFile,
  GeneratedFolder,
  ProjectPluginStructure,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css-modules'

const NEXT_CONFIG_KEY = 'next.config'
const CSS_MODULES_WEBPACK_MARKER = '__tqCssModulesLocalClassNames'

/**
 * The CSS-modules webpack change, APPENDED to whatever `next.config.js` the
 * other plugins wrote rather than replacing it: the config also carries the
 * i18n locales, the pg externals, the security and service-worker headers,
 * and a config written from scratch here silently dropped all of them. Any
 * `webpack` the config already had runs first; this one then keeps the module
 * class names local. Written as-is (not re-formatted) so markers other plugins
 * keep in the file survive.
 */
const CSS_MODULES_WEBPACK_CODE = `
// CSS modules: class names stay local (teleport-project-plugin-css-modules),
// after any webpack change the config above already makes.
const __tqCssModulesRegexEqual = (x, y) =>
  x instanceof RegExp &&
  y instanceof RegExp &&
  x.source === y.source &&
  x.global === y.global &&
  x.ignoreCase === y.ignoreCase &&
  x.multiline === y.multiline

function ${CSS_MODULES_WEBPACK_MARKER}(config) {
  const oneOf = config.module.rules.find((rule) => typeof rule.oneOf === 'object')
  if (oneOf) {
    const moduleCssRule = oneOf.oneOf.find((rule) =>
      __tqCssModulesRegexEqual(rule.test, /\\.module\\.css$/)
    )
    if (moduleCssRule) {
      const cssLoader = moduleCssRule.use.find(({ loader }) => loader.includes('css-loader'))
      if (cssLoader) {
        cssLoader.options.modules.mode = 'local'
      }
    }
  }
  return config
}

const __tqWebpackBeforeCssModules = module.exports.webpack
module.exports.webpack = (config, options) =>
  ${CSS_MODULES_WEBPACK_MARKER}(
    typeof __tqWebpackBeforeCssModules === 'function'
      ? __tqWebpackBeforeCssModules(config, options)
      : config
  )
`

const findTemplateFile = (
  folder: GeneratedFolder | undefined,
  name: string,
  fileType: string
): GeneratedFile | undefined => {
  if (!folder) {
    return undefined
  }
  const own = (folder.files || []).find((file) => file.name === name && file.fileType === fileType)
  if (own) {
    return own
  }
  for (const subFolder of folder.subFolders || []) {
    const found = findTemplateFile(subFolder, name, fileType)
    if (found) {
      return found
    }
  }
  return undefined
}

export const nextBeforeModifier = async (structure: ProjectPluginStructure) => {
  const { strategy } = structure

  if (strategy.id !== 'teleport-project-next') {
    throw new Error('Plugin can be used only with teleport-project-next')
  }

  strategy.style = ReactStyleVariation.CSSModules
  if (strategy?.projectStyleSheet?.generator) {
    strategy.projectStyleSheet = {
      ...strategy.projectStyleSheet,
      plugins: [createStyleSheetPlugin({ moduleExtension: true })],
      importFile: true,
    }
    strategy.framework.config.isGlobalStylesDependent = false
  }
}

export const nextAfterModifier = async (structure: ProjectPluginStructure) => {
  const { files } = structure
  const appFileContent = files.get('_app').files[0].content
  const content = `import "./style.module.css" \n
    ${appFileContent}
    `

  const formattedCode = prettierJS({ [FileType.JS]: content })

  files.set('_app', {
    path: files.get('_app').path,
    files: [
      {
        name: '_app',
        fileType: FileType.JS,
        content: formattedCode[FileType.JS],
      },
    ],
  })

  const configRecord = files.get(NEXT_CONFIG_KEY)
  const existing =
    configRecord?.files.find(
      (file) => file.name === NEXT_CONFIG_KEY && file.fileType === FileType.JS
    ) || findTemplateFile(structure.template, NEXT_CONFIG_KEY, FileType.JS)
  const existingContent = existing ? existing.content : 'module.exports = {}\n'

  // Already composed (the plugin ran twice): nothing to add.
  if (existingContent.indexOf(CSS_MODULES_WEBPACK_MARKER) !== -1) {
    return
  }

  const merged: GeneratedFile = {
    name: NEXT_CONFIG_KEY,
    fileType: FileType.JS,
    content: `${existingContent.replace(/\s*$/, '')}\n${CSS_MODULES_WEBPACK_CODE}`,
  }
  files.set(NEXT_CONFIG_KEY, {
    path: configRecord ? configRecord.path : [],
    files: [
      ...(configRecord ? configRecord.files.filter((file) => file !== existing) : []),
      merged,
    ],
  })
}
