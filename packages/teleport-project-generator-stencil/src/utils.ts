import { GeneratedFolder } from '@teleporthq/teleport-types'
import MagicString from 'magic-string'

export const appendToConfigFile = (
  template: GeneratedFolder,
  dependencies: Record<string, string>,
  fileName: string,
  fileType: string
) => {
  const configFile = template.files.find(
    (file) => file.name === fileName && file.fileType === fileType
  )

  if (!configFile || !configFile.content) {
    throw new Error(`${fileName} not found, while adding global styles`)
  }

  const parsedFile = configFile.content.replace('/n', '//n')

  const magic = new MagicString(parsedFile)
  magic.appendRight(parsedFile.length - 200, `globalStyle: 'src/style.css',`)
  configFile.content = magic.toString()

  return {
    file: configFile,
    dependencies,
  }
}
