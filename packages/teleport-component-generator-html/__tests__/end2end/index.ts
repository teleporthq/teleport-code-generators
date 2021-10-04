// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-html.json'
import { component, elementNode, dynamicNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { FileType, GeneratedFile } from '@teleporthq/teleport-types'
import { createHTMLComponentGenerator } from '../../src'

const findFileByType = (files: GeneratedFile[], type: string = 'js') =>
  files.find((file) => file.fileType === type)

describe('HTML Component Generator', () => {
  const generator = createHTMLComponentGenerator()

  it('should throw error when externals are not passed and the comp uses dependencies', async () => {
    const result = generator.generateComponent(uidlSampleJSON)
    await expect(result).rejects.toThrow(Error)
  })

  it('should return the files containing the code as string', async () => {
    generator.addExternalComponents({
      externals: {
        sample: component(
          'Sample',
          elementNode(
            'container',
            {},
            [staticNode('Hello'), dynamicNode('prop', 'heading')],
            null,
            {
              width: staticNode('100px'),
            }
          ),
          { heading: { type: 'string', defaultValue: 'TeleportHQ' } }
        ),
      },
    })

    const { files } = await generator.generateComponent(uidlSampleJSON)
    const jsFile = findFileByType(files, FileType.HTML)
    const cssFile = findFileByType(files, FileType.CSS)

    expect(jsFile).toBeDefined()
    expect(files.length).toBe(2)
    expect(jsFile.content).toContain('./navbar.css')
    expect(jsFile.content).toContain('<div class="sample-container">')
    expect(cssFile.content).toContain(`.sample-container {`)
  })
})
