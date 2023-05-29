import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { StringUtils } from '@teleporthq/teleport-shared'

export const nextBeforeModifier = async (structure: ProjectPluginStructure) => {
  const { files, projectContexts } = structure

  const { rootFolder = 'contexts', items = {} } = structure.uidl.contexts || {}

  Object.keys(items).forEach((key) => {
    const firstCharCapitalized = StringUtils.capitalize(
      StringUtils.dashCaseToCamelCase(StringUtils.removeIllegalCharacters(items[key].name))
    )
    const contextName = `${firstCharCapitalized}Context`

    const contextContent = prettierJS({
      [FileType.JS]: `
import { createContext, useContext } from 'react'

export const ${contextName} = createContext(null)

export const use${contextName} = () => {
  const context = useContext(${contextName})
  if (!context) {
    throw new Error('use${contextName} must be used within a ${contextName}')
  }
  return context
}
`,
    })

    const fileName = items[key].fileName || items[key].name
    projectContexts[key] = {
      path: `${rootFolder}/${key}`,
      providerName: contextName,
      consumerName: `use${contextName}`,
      fileName,
    }

    files.set(key, {
      path: [rootFolder],
      files: [{ name: fileName, fileType: FileType.JS, content: contextContent[FileType.JS] }],
    })
  })
}

export const nextAfterModifier = async () => {
  return
}
