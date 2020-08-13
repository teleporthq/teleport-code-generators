import { createReactComponentGenerator } from '../../src'
import { GeneratedFile, FileType } from '@teleporthq/teleport-types'
import componentJSON from './component-with-import-definitions.json'

const findFileByType = (files: GeneratedFile[], type: string = FileType.JS) =>
  files.find((file) => file.fileType === type)

describe('Generates component and uses importDefinitions', () => {
  it('Generates component and uses importDefinitions', async () => {
    const generator = createReactComponentGenerator()
    const { files } = await generator.generateComponent(componentJSON)
    const jsFile = findFileByType(files, FileType.JS)

    expect(jsFile.content).toContain(
      `import { theme as defaultTheme, ThemeProvider, Button } from '@chakra-ui/core'`
    )
    expect(jsFile.content).toContain(`<ThemeProvider theme={defaultTheme}>`)
  })
})
