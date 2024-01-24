// @ts-ignore
import componentInputJSON from './component-with-primitive-values.json'
// @ts-ignore
import componentResultJSON from './component-with-proper-values.json'
// @ts-ignore
import componentStyleSetsInputJSON from './component-with-reusalble-styles.json'
// @ts-ignore
import componentWithReferencedStylesJSON from './componennt-with-referenced-styles.json'
// @ts-ignore
import componentWithStateReferences from './compoenent-with-state-reference.json'

import { parseComponentJSON, parseProjectJSON } from '../../src/parser'
import { ComponentUIDL, UIDLConditionalNode } from '@teleporthq/teleport-types'

describe('parseComponentJSON', () => {
  it('transforms primitive component values', () => {
    const componentResult = parseComponentJSON(componentInputJSON)
    expect(componentResult).toEqual(componentResultJSON)
  })
})

describe('parseProjectJSON', () => {
  it('transforms primitive project values', () => {
    const componentResult = parseProjectJSON({
      root: componentInputJSON,
      components: {
        test: componentInputJSON,
      },
    })
    expect(componentResult).toEqual({
      root: componentResultJSON,
      components: {
        test: componentResultJSON,
      },
    })
  })
})

describe('styleSetDefinitions in root of Project UIDL', () => {
  it('Parses and convertes string styles to static nodes in styleSetDefinitions', () => {
    const result = parseProjectJSON({
      root: componentStyleSetsInputJSON,
      components: {},
    })

    expect(result.root.styleSetDefinitions).toStrictEqual({
      primaryButton: {
        type: 'reusable-project-style-map',
        content: {
          background: {
            type: 'static',
            content: 'blue',
          },
          width: {
            type: 'static',
            content: 'auto',
          },
          color: {
            type: 'static',
            content: '#fff',
          },
          border: {
            type: 'static',
            content: '1px solid #fff',
          },
        },
      },
      secondaryButton: {
        type: 'reusable-project-style-map',
        content: {
          background: {
            type: 'static',
            content: 'red',
          },
          width: {
            type: 'static',
            content: 'auto',
          },
          color: {
            type: 'static',
            content: '#fff',
          },
          border: {
            type: 'static',
            content: '1px solid #fff',
          },
        },
      },
    })
  })
})

describe('RefernecedStyles for ComponentUIDL', () => {
  it('Parser referencedStyles and generate static nodes for string based styles', () => {
    const result = parseComponentJSON(componentWithReferencedStylesJSON)

    expect(
      result.node.content.referencedStyles['5ed0cb9ff4fd989551c4edc0'].content.styles
    ).toStrictEqual({ 'flex-wrap': { type: 'static', content: 'wrap' } })
  })

  it('Parses referencedStyles with project-referenced nodes', () => {
    const uidl = componentStyleSetsInputJSON as unknown as ComponentUIDL
    uidl.node.content.referencedStyles = {
      ...uidl.node.content.referencedStyles,
      '5ed6146d471fde6d6a47ba16': {
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: 'secondaryButton',
        },
      },
    }

    const result = parseComponentJSON(uidl as unknown as Record<string, unknown>)
    expect(result).toEqual(result)
  })

  it('Parses reference on a conditional node and changes the state/prop references', () => {
    const result = parseComponentJSON(
      componentWithStateReferences as unknown as Record<string, string>
    )
    const conditionalNode = result.node.content.children?.[0]

    expect(result.stateDefinitions?.isVisible).toBeDefined()
    expect((conditionalNode as UIDLConditionalNode)?.content.reference.content.id).toBe('isVisible')
  })
})
