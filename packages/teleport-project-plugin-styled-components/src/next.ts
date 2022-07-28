import {
  FileType,
  ProjectPluginStructure,
  ReactNativeStyleVariation,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import MagicString from 'magic-string'
import { STYLED_DEPENDENCIES } from './constant'

export const nextBeforeModifier = async (structure: ProjectPluginStructure) => {
  const { strategy } = structure

  if (strategy.id !== 'teleport-project-next') {
    throw new Error('Plugin can be used only with teleport-project-next')
  }

  strategy.style = ReactNativeStyleVariation.StyledComponents
  if (strategy?.projectStyleSheet?.generator) {
    strategy.projectStyleSheet.plugins = [createStyleSheetPlugin(), importStatementsPlugin]
    strategy.projectStyleSheet.postprocessors = [prettierJS]
    strategy.framework.config.isGlobalStylesDependent = false
  }
}

export const nextAfterModifier = async (structure: ProjectPluginStructure) => {
  const { files, dependencies } = structure

  if (!files.get('entry')) {
    throw new Error(`Entry File is missing from the generated project, _document file not found`)
  }

  const fileContent = files.get('entry').files[0].content
  const magicString = new MagicString(fileContent.replace('/n', '//n'))

  magicString.appendRight(70, `\nimport { ServerStyleSheet } from 'styled-components' \n`)
  magicString.appendRight(
    114,
    `\nstatic getInitialProps({ renderPage }) {
  const sheet = new ServerStyleSheet();
  const page = renderPage((App) => (props) =>
    sheet.collectStyles(<App {...props} />),
  );
  const styleTags = sheet.getStyleElement();
  
  return { ...page, styleTags };
  }\n\n`
  )
  magicString.appendRight(175, `\n{this.props.styleTags}`)

  const formattedCode = prettierJS({
    [FileType.JS]: magicString.toString(),
  })

  const babelRc = `{
    "presets": [
      "next/babel"
    ],
    "plugins": [
      [
        "styled-components",
        {
          "ssr": true,
          "displayName": true,
          "preprocess": false
        }
      ]
    ]
  }`

  files.set('entry', {
    path: ['pages'],
    files: [
      {
        name: '_document',
        fileType: FileType.JS,
        content: formattedCode[FileType.JS],
      },
    ],
  })

  files.set('.babelrc', {
    path: [],
    files: [
      {
        name: '.babelrc',
        content: babelRc,
      },
    ],
  })

  Object.keys(STYLED_DEPENDENCIES).forEach((dep: string) => {
    dependencies[dep] = STYLED_DEPENDENCIES[dep]
  })
}
