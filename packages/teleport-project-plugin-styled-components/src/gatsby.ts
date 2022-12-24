import { FileType, ProjectPluginStructure, GatsbyStyleVariation } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-react-styled-components'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import MagicString from 'magic-string'
import { STYLED_DEPENDENCIES } from './constant'

export const gatsbyBeforeModifier = async (structure: ProjectPluginStructure) => {
  const { strategy } = structure

  if (strategy.id !== 'teleport-project-gatsby') {
    throw new Error('Plugin can be used only with teleport-project-gatsby')
  }

  strategy.style = GatsbyStyleVariation.StyledComponents
  delete strategy.framework.config
  if (strategy?.projectStyleSheet?.generator) {
    strategy.projectStyleSheet.plugins = [createStyleSheetPlugin(), importStatementsPlugin]
  }
}

export const gatsbyAfterModifier = async (structure: ProjectPluginStructure) => {
  const { template, files, dependencies } = structure
  const fileName = 'gatsby-config'
  const configFile = template.files.find(
    (file) => file.name === 'gatsby-config' && file.fileType === FileType.JS
  )

  if (!configFile || !configFile.content) {
    throw new Error(`${fileName} not found, while adding gatsby-plugin-styled-components`)
  }

  const parsedFile = configFile.content.replace('/n', '//n')
  const magic = new MagicString(parsedFile)
  magic.appendRight(
    parsedFile.length - 10,
    `,
'gatsby-plugin-styled-components'`
  )
  const content = magic.toString()
  const formattedCode = prettierJS({ [FileType.JS]: content })

  files.set('gatsby-config', {
    path: [],
    files: [{ name: `gatsby-config`, fileType: FileType.JS, content: formattedCode[FileType.JS] }],
  })

  const deps: Record<string, string> = {
    ...STYLED_DEPENDENCIES,
    'gatsby-plugin-styled-components': '^4.6.0',
    'babel-plugin-styled-components': '^1.12.0',
  }

  Object.keys(deps).forEach((dep: string) => {
    dependencies[dep] = deps[dep]
  })
}
