import {
  cleanupDynamicStyles,
  transformStringAssignmentToJson,
  transformStylesAssignmentsToJson,
  transformAttributesAssignmentsToJson,
  findFirstElementNode,
  getComponentPath,
  getComponentFileName,
  getRepeatIteratorNameAndKey,
  extractPageOptions,
} from '../../src/utils/uidl-utils'
import { component, staticNode, elementNode } from '../../src/builders/uidl-builders'
import {
  UIDLStyleDefinitions,
  UIDLElementNode,
  UIDLConditionalNode,
  UIDLRepeatNode,
  UIDLDynamicReference,
  UIDLSlotNode,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'

// @ts-ignore
import uidlStyleJSON from './uidl-utils-style.json'

describe('cleanupDynamicStyles', () => {
  const styleObject = uidlStyleJSON as UIDLStyleDefinitions

  it('removes dynamic styles from nested style objects', () => {
    cleanupDynamicStyles(styleObject)
    const cleanedStyle = (cleanupDynamicStyles(styleObject) as unknown) as UIDLStyleDefinitions
    expect(cleanedStyle.padding).toBeUndefined()
    expect(cleanedStyle.margin.content).toBe('20px')
    const nestedStyle = (cleanedStyle[':hover'] as unknown) as UIDLStyleDefinitions
    expect((nestedStyle.content as Record<string, any>).padding).toBeUndefined()
    expect((nestedStyle.content as Record<string, any>).margin.content).toBe('10px')
  })
})

describe('transformStringAssignmentToJson', () => {
  const inputOutputMap = {
    '$props.direction': {
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: 'direction',
      },
    },

    '$state.direction': {
      type: 'dynamic',
      content: {
        referenceType: 'state',
        id: 'direction',
      },
    },

    '$local.direction': {
      type: 'dynamic',
      content: {
        referenceType: 'local',
        id: 'direction',
      },
    },

    'static content 1': {
      type: 'static',
      content: `static content 1`,
    },
  }

  it('transforms props string to json', () => {
    Object.keys(inputOutputMap).forEach((key) => {
      expect(transformStringAssignmentToJson(key)).toEqual(inputOutputMap[key])
    })
  })
})

describe('transformStylesAssignmentsToJson', () => {
  it('transforms static styles to new json', () => {
    const inputStyle = {
      float: 'left',
    }

    const expectedStyle = {
      float: { type: 'static', content: 'left' },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('leaves static styles json alone', () => {
    const inputStyle = {
      float: { type: 'static', content: 'left' },
      width: 32,
    }

    const expectedStyle = {
      float: { type: 'static', content: 'left' },
      width: { type: 'static', content: 32 },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('leaves dynamic styles json alone', () => {
    const inputStyle = {
      width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
    }

    const expectedStyle = {
      width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('transforms dynamic styles to new json', () => {
    const inputStyle = {
      width: '$props.size',
    }

    const expectedStyle = {
      width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('transforms nested styles to new json', () => {
    const nestedStyle = {
      '@media(max-widht:300px)': {
        flex: '1 1 row',
        width: '$props.size',
      },
    }

    const expectedStyle = {
      '@media(max-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
        },
      },
    }

    expect(transformStylesAssignmentsToJson(nestedStyle)).toEqual(expectedStyle)
  })

  it('transforms mixed styles to new json', () => {
    const nestedStyle = {
      '@media(max-widht:300px)': {
        flex: '1 1 row',
        width: '$props.size',
        parsedValue: {
          type: 'static',
          content: 'parsed',
        },
      },

      // already parsed, should be left untouched
      '@media(min-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
          heght: '$props.size',
        },
      },
    }

    const expectedStyle = {
      '@media(max-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
          parsedValue: {
            type: 'static',
            content: 'parsed',
          },
        },
      },

      '@media(min-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
          heght: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
        },
      },
    }

    expect(transformStylesAssignmentsToJson(nestedStyle)).toEqual(expectedStyle)
  })
})

describe('transformAttributesAssignmentsToJson', () => {
  it('transforms attrs styles to new json', () => {
    const inputStyle = {
      float: { type: 'static', content: 'left' },
      width: 32,
      height: '$state.expandedSize',
      flexDirection: { type: 'dynamic', content: { referenceType: 'prop', id: 'direction' } },
    }

    const expectedStyle = {
      float: { type: 'static', content: 'left' },
      width: { type: 'static', content: 32 },
      height: { type: 'dynamic', content: { referenceType: 'state', id: 'expandedSize' } },
      flexDirection: { type: 'dynamic', content: { referenceType: 'prop', id: 'direction' } },
    }

    expect(transformAttributesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })
})

describe('traverses the UIDL and returns the first element node that is found', () => {
  const inputElementNode: UIDLElementNode = {
    type: 'element',
    content: {
      elementType: 'container',
    },
  }

  it('returns the same node, when the passed node is element node', () => {
    const firstElmNode = findFirstElementNode(inputElementNode)
    expect(firstElmNode).toBe(inputElementNode)
  })

  it('returns the inputElementNode when the root is a conditional element', () => {
    const conditionalNode: UIDLConditionalNode = {
      type: 'conditional',
      content: {
        node: inputElementNode,
        reference: {
          type: 'dynamic',
          content: {
            referenceType: 'prop',
            id: 'isVisible',
          },
        },
      },
    }
    const firstElmNode = findFirstElementNode(conditionalNode)
    expect(firstElmNode).toBe(inputElementNode)
  })

  it('returns the inputElementNode when the root is a repeat element', () => {
    const repeatNode: UIDLRepeatNode = {
      type: 'repeat',
      content: {
        node: inputElementNode,
        dataSource: {
          type: 'dynamic',
          content: {
            referenceType: 'prop',
            id: 'items',
          },
        },
      },
    }

    const firstElmNode = findFirstElementNode(repeatNode)
    expect(firstElmNode).toBe(inputElementNode)
  })

  it('returns the inputElementNode when the UIDL has multiple element nodes', () => {
    const nestedNode: UIDLElementNode = {
      ...inputElementNode,
      content: {
        ...inputElementNode.content,
        children: [inputElementNode, inputElementNode],
      },
    }
    const nestedinputConditonalNode: UIDLConditionalNode = {
      type: 'conditional',
      content: {
        node: nestedNode,
        reference: {
          type: 'dynamic',
          content: {
            referenceType: 'state',
            id: 'isOpen',
          },
        },
      },
    }

    const firstElmNode = findFirstElementNode(nestedinputConditonalNode)
    expect(firstElmNode).toBe(nestedNode)
  })

  it('throws error if a static is passed', () => {
    const node = staticNode('This is a static value')

    try {
      findFirstElementNode(node)
    } catch (e) {
      expect(e.message).toContain('UIDL does not have any element node')
    }
  })

  it('throws error if a dynamic is passed', () => {
    const dynamicNode: UIDLDynamicReference = {
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: 'isOpen',
      },
    }

    try {
      findFirstElementNode(dynamicNode)
    } catch (e) {
      expect(e.message).toContain('UIDL does not have any element node')
    }
  })

  it('throws error if a static is passed', () => {
    const slotNode: UIDLSlotNode = {
      type: 'slot',
      content: {
        name: 'slotNode',
      },
    }

    try {
      findFirstElementNode(slotNode)
    } catch (e) {
      expect(e.message).toContain('UIDL does not have any element node')
    }
  })
})

describe('getComponentFileName', () => {
  const testComponent = component('MyComponent', elementNode('random'))

  it('returns the dashcase filename', () => {
    expect(getComponentFileName(testComponent)).toBe('my-component')
  })

  it('meta fileName overrides', () => {
    testComponent.outputOptions = {
      fileName: 'my-custom-name',
    }
    expect(getComponentFileName(testComponent)).toBe('my-custom-name')
  })
})

describe('getComponentPath', () => {
  const testComponent = component('MyComponent', elementNode('random'))

  it('returns an empty array if no meta path is provided', () => {
    expect(getComponentPath(testComponent)).toHaveLength(0)
  })

  it('returns the input meta path', () => {
    testComponent.outputOptions = {
      folderPath: ['one', 'two'],
    }

    const path = getComponentPath(testComponent)
    expect(path).toContain('one')
    expect(path).toContain('two')
    expect(path.length).toBe(2)
  })
})

describe('getRepeatIteratorNameAndKey', () => {
  it('returns the fallback as name and key', () => {
    const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey()
    expect(iteratorName).toBe('item')
    expect(iteratorKey).toBe('item')
  })

  it('returns the fallback as name and index as key', () => {
    const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey({
      useIndex: true,
    })
    expect(iteratorName).toBe('item')
    expect(iteratorKey).toBe('index')
  })

  it('returns the iteratorName as name and as key', () => {
    const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey({
      iteratorName: 'listItem',
    })
    expect(iteratorName).toBe('listItem')
    expect(iteratorKey).toBe('listItem')
  })

  it('returns the iteratorName as name and index as key', () => {
    const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey({
      iteratorName: 'listItem',
      useIndex: true,
    })
    expect(iteratorName).toBe('listItem')
    expect(iteratorKey).toBe('index')
  })

  it('returns the iteratorName as name and iteratorKey as key', () => {
    const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey({
      iteratorName: 'listItem',
      iteratorKey: 'listItem.id',
      useIndex: true,
    })
    expect(iteratorName).toBe('listItem')
    expect(iteratorKey).toBe('listItem.id')
  })

  it('returns the fallback iterator name as name and iteratorKey as key', () => {
    const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey({
      iteratorKey: 'item.id',
    })
    expect(iteratorName).toBe('item')
    expect(iteratorKey).toBe('item.id')
  })
})

describe('extractPageOptions', () => {
  const routeDefinitions: UIDLStateDefinition = {
    type: 'string',
    defaultValue: 'home',
    values: [
      {
        value: 'home',
        pageOptions: {
          navLink: '/',
        },
      },
      {
        value: 'about',
        pageOptions: {
          navLink: '/about-us',
          componentName: 'AboutUs',
        },
      },
      {
        value: 'contact-us',
        pageOptions: {
          navLink: '/team',
        },
      },
      {
        value: 'no-meta',
      },
    ],
  }

  it('uses the state for a non-declared page', () => {
    const result = extractPageOptions(routeDefinitions, 'non-declared')
    expect(result.navLink).toBe('/non-declared')
    expect(result.fileName).toBe('non-declared')
    expect(result.componentName).toBe('non-declared')
  })

  it('uses the state for a page without meta', () => {
    const result = extractPageOptions(routeDefinitions, 'no-meta')
    expect(result.navLink).toBe('/no-meta')
    expect(result.fileName).toBe('no-meta')
    expect(result.componentName).toBe('no-meta')
  })

  it('returns values from the meta with defaults from the state', () => {
    const result = extractPageOptions(routeDefinitions, 'about')
    expect(result.navLink).toBe('/about-us') // meta value
    expect(result.fileName).toBe('about') // state value
    expect(result.componentName).toBe('AboutUs') // meta value
  })

  it('converts the fileName to index', () => {
    const result = extractPageOptions(routeDefinitions, 'home', true)
    expect(result.navLink).toBe('/')
    expect(result.fileName).toBe('index')
    expect(result.componentName).toBe('home')
  })

  it('uses the path as the fileName', () => {
    const result = extractPageOptions(routeDefinitions, 'about', true)
    expect(result.navLink).toBe('/about-us')
    expect(result.fileName).toBe('about-us')
    expect(result.componentName).toBe('AboutUs')
  })
})
