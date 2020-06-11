// @ts-ignore
import componentInputJSON from './component-with-primitive-values.json'
// @ts-ignore
import componentResultJSON from './component-with-proper-values.json'
// @ts-ignore
import componentStyleSetsInputJSON from './component-with-reusalble-styles.json'
// @ts-ignore
import componentWithReferencedStylesJSON from './componennt-with-referenced-styles.json'

import { parseComponentJSON, parseProjectJSON } from '../../src/parser'

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
      '5ed0d05baa77d97673711820': {
        id: '5ed0d05baa77d97673711820',
        name: 'primaryButton',
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
      '5ed0d4923de727e93cb4efa2': {
        id: '5ed0d4923de727e93cb4efa2',
        name: 'secondaryButton',
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
    const uidl = componentStyleSetsInputJSON
    uidl.node.content.referencedStyles = {
      ...uidl.node.content.referencedStyles,
      '5ed6146d471fde6d6a47ba16': {
        id: '5ed6146d471fde6d6a47ba16',
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: '5ed6146d471fde6d6a47ba1b',
        },
      },
    }

    const result = parseComponentJSON(uidl)
    expect(result).toEqual(result)
  })

  it('Parses referencedStyles with project-referenced nodes and throws if they are applied conditionally', () => {
    const uidl = componentStyleSetsInputJSON
    uidl.node.content.referencedStyles = {
      ...uidl.node.content.referencedStyles,
      '5ed6146d471fde6d6a47ba16': {
        id: '5ed6146d471fde6d6a47ba16',
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          conditions: [],
          referenceId: '5ed6146d471fde6d6a47ba1b',
        },
      },
    }

    expect(() => parseComponentJSON(uidl)).toThrow()
  })
})
