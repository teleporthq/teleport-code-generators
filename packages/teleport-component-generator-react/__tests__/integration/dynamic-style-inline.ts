import { createReactComponentGenerator } from '../../src'
import {
  ComponentUIDL,
  GeneratedFile,
  FileType,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import { dynamicNode, staticNode, component, elementNode } from '@teleporthq/teleport-uidl-builders'

const findFileByType = (files: GeneratedFile[], type: string = FileType.JS) =>
  files.find((file) => file.fileType === type)

/**
 * A dynamic STYLE value bound to an object PROP field (a prop reference with a
 * refPath) must be emitted as an INLINE `style={{ ... }}` expression that keeps
 * the full member access — NOT left to the styled-jsx `${props.x}` interpolation,
 * which only uses `content.id` and would drop the refPath (producing
 * `props.product` instead of `props.product.color`).
 */
describe('Dynamic style values → inline style', () => {
  const ComponentWithObjectPropStyle: ComponentUIDL = component(
    'ComponentWithObjectPropStyle',
    elementNode('container', {}, [], undefined, {
      backgroundColor: dynamicNode('prop', 'product', ['color']),
      alignSelf: staticNode('center'),
    }),
    {
      product: {
        type: 'object',
        defaultValue: {},
      },
    }
  )

  it('inlines an object-prop-field style (prop + refPath) with the full path', async () => {
    const generator = createReactComponentGenerator({ variation: ReactStyleVariation.StyledJSX })
    const result = await generator.generateComponent(ComponentWithObjectPropStyle)
    const jsFile = findFileByType(result.files, FileType.JS)

    expect(jsFile).toBeDefined()
    // The full object-field access is inlined (optional-chained), keeping refPath.
    expect(jsFile?.content).toContain('style={{')
    expect(jsFile?.content).toContain("props.product?.['color']")
    // …and the styled-jsx CSS block does NOT carry a broken `props.product`
    // background-color declaration (which would drop the `.color` refPath).
    expect(jsFile?.content).not.toContain(`background-color: \${props.product}`)
    // The static sibling still goes through the shared CSS class.
    expect(jsFile?.content).toContain('align-self: center')
  })

  it('keeps a SIMPLE prop style (no refPath) on the styled-jsx interpolation path', async () => {
    const ComponentWithSimplePropStyle: ComponentUIDL = component(
      'ComponentWithSimplePropStyle',
      elementNode('container', {}, [], undefined, {
        color: dynamicNode('prop', 'textColor'),
      }),
      {
        textColor: {
          type: 'string',
          defaultValue: 'black',
        },
      }
    )
    const generator = createReactComponentGenerator({ variation: ReactStyleVariation.StyledJSX })
    const result = await generator.generateComponent(ComponentWithSimplePropStyle)
    const jsFile = findFileByType(result.files, FileType.JS)

    expect(jsFile).toBeDefined()
    // Simple prop stays a styled-jsx interpolation inside the <style jsx> block.
    expect(jsFile?.content).toContain(`\${props.textColor}`)
  })
})
