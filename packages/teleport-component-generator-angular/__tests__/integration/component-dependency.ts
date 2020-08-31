import { createAngularComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import componentJSON from './component-with-smilar-element-name-depependencies.json'

const generator = createAngularComponentGenerator()

const TS_FILE = 'ts'
const HTML_FILE = 'html'
const findFileByType = (files: GeneratedFile[], type: string = TS_FILE) =>
  files.find((file) => file.fileType === type)

describe('Component Dependencies', () => {
  it('Imports and re-maps component dependencies if there are any duplicates', async () => {
    const result = await generator.generateComponent(componentJSON)
    const tsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)

    expect(tsFile).toBeDefined()
    expect(htmlFile).toBeDefined()
    expect(htmlFile.content).toContain(`[tokens]="tokens" [components]="components"`)
    expect(tsFile.content).toContain(`import { tokens, components } from 'react-ui'`)
    expect(tsFile.content).toContain(`tokens = tokens`)
    expect(tsFile.content).toContain(`components = components`)
    expect(tsFile.content).not.toContain(`antdCSS = antdCSS`)
  })
})
