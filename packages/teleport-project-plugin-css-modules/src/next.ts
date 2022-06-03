import { FileType, ProjectPluginStructure, ReactStyleVariation } from '@teleporthq/teleport-types'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css-modules'

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

  const nextContent = prettierJS({
    [FileType.JS]: `const regexEqual = (x, y) => {
  return (
    x instanceof RegExp &&
    y instanceof RegExp &&
    x.source === y.source &&
    x.global === y.global &&
    x.ignoreCase === y.ignoreCase &&
    x.multiline === y.multiline
  );
};

module.exports = {
  webpack: (config) => {
    const oneOf = config.module.rules.find(
      (rule) => typeof rule.oneOf === 'object'
    );

    if (oneOf) {
      const moduleCssRule = oneOf.oneOf.find(
        (rule) => regexEqual(rule.test, /\\.module\\.css$/)
      );

      if (moduleCssRule) {
        const cssLoader = moduleCssRule.use.find(({ loader }) =>
          loader.includes('css-loader')
        );
        if (cssLoader) {
          cssLoader.options.modules.mode = 'local';
        }
      }
    }

    return config;
  },
};`,
  })

  files.set('next.config', {
    path: [],
    files: [
      {
        name: 'next.config',
        fileType: FileType.JS,
        content: nextContent[FileType.JS],
      },
    ],
  })
}
