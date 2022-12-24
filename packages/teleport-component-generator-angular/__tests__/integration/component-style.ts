import ComponentWithNestedStyle from './component-with-nested-styles.json'

import { createAngularComponentGenerator } from '../../src/index'
import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'
import { component, elementNode, dynamicNode, staticNode } from '@teleporthq/teleport-uidl-builders'

const ComponentWithValidStyle: ComponentUIDL = component(
  'ComponentWithAttrProp',
  elementNode('container', {}, [], null, {
    flexDirection: dynamicNode('prop', 'direction'),
    height: dynamicNode('prop', 'config.height'),
    alignSelf: staticNode('center'),
  }),
  {
    direction: {
      type: 'string',
      defaultValue: 'row',
    },
    config: {
      type: 'object',
      defaultValue: {
        height: 32,
      },
    },
  },
  {}
)

const TS_FILE = 'ts'
const CSS_FILE = 'css'
const HTML_FILE = 'html'
const findFileByType = (files: GeneratedFile[], type: string = TS_FILE) =>
  files.find((file) => file.fileType === type)

describe('Styles in Angular Component Generator', () => {
  const generator = createAngularComponentGenerator()

  it('Adds dynamic styles to the tempalte', async () => {
    const result = await generator.generateComponent(ComponentWithValidStyle)
    const tsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)
    const cssFile = findFileByType(result.files, CSS_FILE)

    expect(result.files.length).toBe(3)
    expect(tsFile).toBeDefined()
    expect(cssFile).toBeDefined()
    expect(htmlFile).toBeDefined()
    expect(tsFile.content).toContain(`@Input()`)
    expect(tsFile.content).toContain(`direction: string = 'row'`)
    expect(tsFile.content).toContain(`config: unknown =`)
    expect(htmlFile.content).toContain(
      `[ngStyle]="{flexDirection: direction, height: config.height}"`
    )
    expect(htmlFile.content).toContain(`class="component-with-attr-prop-container"`)
    expect(cssFile.content).toContain(`.component-with-attr-prop-container {`)
    expect(cssFile.content).toContain(`align-self: center;`)
  })

  it('Generates nested styles in css', async () => {
    const result = generator.generateComponent(ComponentWithNestedStyle as ComponentUIDL)

    await expect(result).rejects.toThrow()
  })
})
