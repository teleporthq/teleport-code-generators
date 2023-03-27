import {
  cleanupDynamicStyles,
  transformStringAssignmentToJson,
  transformStylesAssignmentsToJson,
  transformAttributesAssignmentsToJson,
  findFirstElementNode,
  createWebComponentFriendlyName,
  extractRoutes,
  getComponentFolderPath,
  getComponentFileName,
  getStyleFileName,
  getTemplateFileName,
  getRepeatIteratorNameAndKey,
  prefixAssetsPath,
  traverseNodes,
  traverseElements,
  traverseRepeats,
  extractExternalDependencies,
  splitDynamicAndStaticStyles,
} from '../../src/utils/uidl-utils'
import {
  component,
  staticNode,
  elementNode,
  dynamicNode,
  repeatNode,
  conditionalNode,
  slotNode,
} from '@teleporthq/teleport-uidl-builders'
import {
  UIDLStyleDefinitions,
  UIDLElementNode,
  UIDLConditionalNode,
  UIDLRepeatNode,
  UIDLDynamicReference,
  UIDLSlotNode,
  UIDLAttributeValue,
  ComponentUIDL,
  UIDLDependency,
} from '@teleporthq/teleport-types'

import uidlStyleJSON from './uidl-utils-style.json'
import projectUIDL from '../../../../examples/test-samples/project-sample.json'

describe('Assembly Line', () => {
  it('extract external dependencies', () => {
    const dependencies: Record<string, UIDLDependency> = {
      react: {
        type: 'library',
        path: 'react',
        version: '16.8.0',
      },
      antd: {
        type: 'package',
        path: 'antd',
        version: '4.5.1',
        meta: {
          namedImport: true,
        },
      },
    }
    const result = extractExternalDependencies(dependencies)

    expect(Object.keys(result).length).toBe(1)
  })
})

describe('cleanupDynamicStyles', () => {
  const styleObject = uidlStyleJSON as UIDLStyleDefinitions

  it('removes dynamic styles from nested style objects', () => {
    cleanupDynamicStyles(styleObject)
    const cleanedStyle = cleanupDynamicStyles(styleObject) as unknown as UIDLStyleDefinitions
    expect(cleanedStyle.padding).toBeUndefined()
    expect(cleanedStyle.margin.content).toBe('20px')
  })
})

describe('transformStringAssignmentToJson', () => {
  const inputOutputMap: Record<string, UIDLAttributeValue> = {
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

  it('Nested styles are not supported', () => {
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

    expect(transformStylesAssignmentsToJson(nestedStyle)).toEqual({})
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
    const node: UIDLConditionalNode = {
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
    const firstElmNode = findFirstElementNode(node)
    expect(firstElmNode).toBe(inputElementNode)
  })

  it('returns the inputElementNode when the root is a repeat element', () => {
    const node: UIDLRepeatNode = {
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

    const firstElmNode = findFirstElementNode(node)
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
    const node: UIDLDynamicReference = {
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: 'isOpen',
      },
    }

    try {
      findFirstElementNode(node)
    } catch (e) {
      expect(e.message).toContain('UIDL does not have any element node')
    }
  })

  it('throws error if a static is passed', () => {
    const node: UIDLSlotNode = {
      type: 'slot',
      content: {
        name: 'slotNode',
      },
    }

    try {
      findFirstElementNode(node)
    } catch (e) {
      expect(e.message).toContain('UIDL does not have any element node')
    }
  })
})

describe('extractRoutes', () => {
  const root = projectUIDL.root as ComponentUIDL
  const result = extractRoutes(root)
  expect(result.length).toBe(3)
  expect(result[0].content.value).toBe('index')
  expect(result[1].content.value).toBe('about')
  expect(result[2].content.value).toBe('contact-us')
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

describe('getStyleFileName', () => {
  const testComponent = component('MyComponent', elementNode('random'))

  it('returns the dashcase filename', () => {
    expect(getStyleFileName(testComponent)).toBe('my-component')
  })

  it('returns the specific style filename', () => {
    testComponent.outputOptions = {
      styleFileName: 'my-custom-name',
    }
    expect(getStyleFileName(testComponent)).toBe('my-custom-name')
  })
})

describe('getTemplateFileName', () => {
  const testComponent = component('MyComponent', elementNode('random'))

  it('returns the dashcase filename', () => {
    expect(getTemplateFileName(testComponent)).toBe('my-component')
  })

  it('meta fileName overrides', () => {
    testComponent.outputOptions = {
      templateFileName: 'my-custom-name',
    }
    expect(getTemplateFileName(testComponent)).toBe('my-custom-name')
  })
})

describe('getComponentFolderPath', () => {
  const testComponent = component('MyComponent', elementNode('random'))

  it('returns an empty array if no meta path is provided', () => {
    expect(getComponentFolderPath(testComponent)).toHaveLength(0)
  })

  it('returns the input meta path', () => {
    testComponent.outputOptions = {
      folderPath: ['one', 'two'],
    }

    const path = getComponentFolderPath(testComponent)
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

describe('prefixAssetsPath', () => {
  it('returns the concatenated path and adds a slash', () => {
    expect(
      prefixAssetsPath('/kitten.png', {
        prefix: '/static',
        identifier: 'playground_assets',
        mappings: { 'kitten.png': '' },
      })
    ).toBe('/static/playground_assets/kitten.png')
  })

  it('returns the original string appended with custom path for the asset', () => {
    expect(
      prefixAssetsPath('/kitten.png', {
        prefix: '/no',
        identifier: 'identifier',
        mappings: { 'kitten.png': 'custom' },
      })
    ).toBe('/no/identifier/custom/kitten.png')
  })

  it('returns the original string appended with custom path for the asset without identifier', () => {
    expect(
      prefixAssetsPath('/kitten.png', {
        prefix: '/noidentifier',
        mappings: { 'kitten.png': 'custom' },
      })
    ).toBe('/noidentifier/custom/kitten.png')
  })

  it('returns the original string appended with prefix without identifier', () => {
    expect(
      prefixAssetsPath('/kitten.png', {
        prefix: '/noidentifier',
      })
    ).toBe('/noidentifier/kitten.png')
  })
})

const nodeToTraverse = elementNode(
  'container',
  {},
  [
    staticNode('static'),
    dynamicNode('prop', 'title'),
    elementNode(
      'container',
      {
        attr: staticNode('dummy-attr'),
      },
      [
        repeatNode(elementNode('container', {}, []), dynamicNode('prop', 'items')),
        conditionalNode(dynamicNode('state', 'visible'), elementNode('text', {}, []), true),
        slotNode(staticNode('fallback'), 'slot-1'),
      ]
    ),
  ],
  null,
  {
    margin: staticNode('10px'),
    height: dynamicNode('prop', 'height'),
  }
)

describe('traverseNodes', () => {
  it('counts the total number of nodes', () => {
    let counter = 0
    traverseNodes(nodeToTraverse, () => counter++)
    expect(counter).toBe(13)
  })
})

describe('traverseElements', () => {
  it('counts the number of element nodes', () => {
    let counter = 0
    traverseElements(nodeToTraverse, () => counter++)
    expect(counter).toBe(4)
  })
})

describe('traverseRepeats', () => {
  it('counts the number of repeat nodes', () => {
    let counter = 0
    traverseRepeats(nodeToTraverse, () => counter++)
    expect(counter).toBe(1)
  })
})

describe('createWebComponentFriendlyName', () => {
  it('creates a dash based component', () => {
    expect(createWebComponentFriendlyName('primaryButton')).toBe('primary-button')
  })

  it('prefixes with app-', () => {
    expect(createWebComponentFriendlyName('Component')).toBe('app-component')
  })
})

describe('splitDynamicAndStaticStyles', () => {
  it('Splits dynamic, static and token styles from a style object', () => {
    const style = {
      width: staticNode('100px'),
      height: staticNode('50px'),
      display: dynamicNode('prop', 'display'),
      color: dynamicNode('token', 'blue'),
    }

    const { staticStyles, dynamicStyles, tokenStyles } = splitDynamicAndStaticStyles(style)
    expect(Object.keys(staticStyles).length).toBe(2)
    expect(Object.keys(dynamicStyles).length).toBe(1)
    expect(Object.keys(tokenStyles).length).toBe(1)
  })
})
