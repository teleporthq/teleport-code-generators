import {
  staticNode,
  repeatNode,
  elementNode,
  dynamicNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import {
  generateUniqueKeys,
  createNodesLookup,
  resolveChildren,
  resolveNavlinks,
  ensureDataSourceUniqueness,
  mergeMappings,
} from '../../src/resolver/utils'
import {
  UIDLElement,
  UIDLNode,
  UIDLStateDefinition,
  UIDLRepeatNode,
} from '@teleporthq/teleport-types'

describe('generateUniqueKeys', () => {
  it('adds name and key to node', async () => {
    const simpleNode = elementNode('container')

    const lookup = {
      container: {
        count: 1,
        nextKey: '0',
      },
    }

    generateUniqueKeys(simpleNode, lookup)

    expect(simpleNode.content.name).toBe('container')
    expect(simpleNode.content.key).toBe('container')
  })

  it('adds name and generate unique key', async () => {
    const node = elementNode('container', {}, [elementNode('container')])

    const lookup = {
      container: {
        count: 2,
        nextKey: '0',
      },
    }

    generateUniqueKeys(node, lookup)

    expect(node.content.name).toBe('container')
    expect(node.content.key).toBe('container')

    const childNode = node.content.children[0].content as UIDLElement
    expect(childNode.name).toBe('container')
    expect(childNode.key).toBe('container1')
  })
})

describe('createNodesLookup', () => {
  it('counts duplicate nodes inside the UIDL', async () => {
    const node = elementNode('container', {}, [
      elementNode('container', {}, [elementNode('text'), elementNode('text'), elementNode('text')]),
    ])

    const lookup: Record<string, { count: number; nextKey: string }> = {}
    createNodesLookup(node, lookup)

    expect(lookup.container.count).toBe(2)
    expect(lookup.container.nextKey).toBe('0')
    expect(lookup.text.count).toBe(3)
    expect(lookup.container.nextKey).toBe('0')
  })

  it('adds zero padding when counting keys', async () => {
    const node = elementNode('container')

    const lookup: Record<string, { count: number; nextKey: string }> = {
      container: {
        count: 9,
        nextKey: '0',
      },
    }
    createNodesLookup(node, lookup)

    expect(lookup.container.count).toBe(10)
    expect(lookup.container.nextKey).toBe('00')
  })
})

describe('ensureDataSourceUniqueness', () => {
  it('set dataSourceIdentifier as "items" if only one repeat is in the node', () => {
    const repeatNodeSample = repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      { type: 'static', content: [] },
      {
        useIndex: true,
      }
    )

    ensureDataSourceUniqueness(repeatNodeSample)

    expect(repeatNodeSample.content.meta.dataSourceIdentifier).toBe('items')
  })

  it('set incremental dataSourceIdenfiers if multiple repeat structures are in the node', () => {
    const repeatNodeSample = repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      { type: 'static', content: [] },
      {
        useIndex: true,
      }
    )

    const repeatNodeSample1 = JSON.parse(JSON.stringify(repeatNodeSample))
    const element = elementNode('container', {}, [repeatNodeSample, repeatNodeSample1])

    ensureDataSourceUniqueness(element)
    const firstRepeat = element.content.children[0] as UIDLRepeatNode
    const secondRepeat = element.content.children[1] as UIDLRepeatNode

    expect(firstRepeat.content.meta.dataSourceIdentifier).toBe('items')
    expect(secondRepeat.content.meta.dataSourceIdentifier).toBe('items1')
  })
})

describe('resolveNode', () => {
  it('elementNode', () => {
    const elementNodeSample = elementNode('container')
    expect(elementNodeSample.content.name).toBe('container')
  })
  it('repeatNode', () => {
    const repeatNodeSample = repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      dynamicNode('prop', 'items'),
      {
        useIndex: true,
      }
    )
    expect(repeatNodeSample.content.node.type).toBe('element')
    expect(repeatNodeSample.content.node.content).toHaveProperty('name', 'div')
    expect(repeatNodeSample.content.node.content).toHaveProperty('children')
  })
})

describe('resolveChildren', () => {
  it('merges the children when no placeholder is found', () => {
    const mappedChildren = [staticNode('from-mapping')]
    const originalChildren = [staticNode('original-text')]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(2)
    expect(result[0].content).toBe('original-text')
    expect(result[1].content).toBe('from-mapping')
  })

  it('adds the mapped children if no original children are found', () => {
    const mappedChildren = [staticNode('from-mapping')]

    const result = resolveChildren(mappedChildren)
    expect(result.length).toBe(1)
    expect(result[0].content).toBe('from-mapping')
  })

  it('inserts the original children instead of the placeholder', () => {
    const mappedChildren = [dynamicNode('children', 'children')]
    const originalChildren = [staticNode('original-text')]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    expect(result[0].content).toBe('original-text')
  })

  it('inserts the original children in the nested structure, instead of the placeholder', () => {
    const mappedChildren = [elementNode('container', {}, [dynamicNode('children', 'children')])]
    const originalChildren = [staticNode('original-text')]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    const innerChildren = ((result[0].content as unknown) as UIDLElement).children
    expect(innerChildren.length).toBe(1)
    expect(innerChildren[0].content).toBe('original-text')
  })

  it('inserts multiple nodes instead of the placeholder', () => {
    const mappedChildren = [
      elementNode('container', {}, [
        dynamicNode('children', 'children'),
        staticNode('remains here'),
      ]),
    ]

    const originalChildren: UIDLNode[] = [
      staticNode('original-text'),
      staticNode('other-original-text'),
    ]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    const innerChildren = ((result[0].content as unknown) as UIDLElement).children
    expect(innerChildren.length).toBe(3)
    expect(innerChildren[0].content).toBe('original-text')
    expect(innerChildren[1].content).toBe('other-original-text')
    expect(innerChildren[2].content).toBe('remains here')
  })

  it('inserts multiple nodes instead of multiple placeholders', () => {
    const mappedChildren = [
      elementNode('container', {}, [
        dynamicNode('children', 'children'),
        staticNode('remains here'),
        dynamicNode('children', 'children'),
      ]),
    ]

    const originalChildren: UIDLNode[] = [
      staticNode('original-text'),
      staticNode('other-original-text'),
    ]

    const result = resolveChildren(mappedChildren, originalChildren)
    expect(result.length).toBe(1)
    const innerChildren = ((result[0].content as unknown) as UIDLElement).children
    expect(innerChildren.length).toBe(5)
    expect(innerChildren[0].content).toBe('original-text')
    expect(innerChildren[1].content).toBe('other-original-text')
    expect(innerChildren[2].content).toBe('remains here')
    expect(innerChildren[3].content).toBe('original-text')
    expect(innerChildren[4].content).toBe('other-original-text')
  })
})

describe('resolveNavlinks', () => {
  const routeDef: UIDLStateDefinition = {
    type: 'string',
    defaultValue: 'home-link',
    values: [
      {
        value: 'home-link',
        pageOptions: {
          navLink: '/home',
        },
      },
    ],
  }

  it('replaces the transitionTo attribute content', () => {
    const navlink = elementNode('navlink', {
      transitionTo: staticNode('home-link'),
    })

    const uidlNode = elementNode('container', {}, [elementNode('div', {}, [navlink])])

    resolveNavlinks(uidlNode, routeDef)
    expect(navlink.content.attrs.transitionTo.content).toBe('/home')
  })

  it('does not change an attribute which starts with /', () => {
    const navlink = elementNode('navlink', {
      transitionTo: staticNode('/home-link'),
    })

    const uidlNode = elementNode('container', {}, [elementNode('div', {}, [navlink])])

    resolveNavlinks(uidlNode, routeDef)
    expect(navlink.content.attrs.transitionTo.content).toBe('/home-link')
  })

  it('throws an error for dynamic attributes', () => {
    const navlink = elementNode('navlink', {
      transitionTo: dynamicNode('prop', 'path'),
    })

    expect(() => resolveNavlinks(navlink, routeDef)).toThrow(
      "Navlink does not support dynamic 'transitionTo' attributes"
    )
  })

  it('does not change the attribute if no route is present', () => {
    const navlink = elementNode('navlink', {
      transitionTo: staticNode('non-existing-state'),
    })

    const warn = jest.spyOn(global.console, 'warn')

    resolveNavlinks(navlink, routeDef)

    expect(warn).toHaveBeenCalledWith(
      "No navlink was defined for router state: 'non-existing-state'. Falling back to '/non-existing-state'"
    )
    expect(navlink.content.attrs.transitionTo.content).toBe('/non-existing-state')
  })
})

describe('mergeMappings', () => {
  const oldMapping = {
    elements: {
      text: {
        elementType: 'span',
      },
      picture: {
        elementType: 'picture',
        children: [{ type: 'dynamic', content: { referenceType: 'children', id: 'children' } }],
      },
    },
    events: {},
    attributes: {},
  }

  const newMapping = {
    elements: {
      text: {
        elementType: 'span',
      },
      picture: {
        elementType: 'picture',
        children: [
          { type: 'static', content: 'This browser does not support the image formats given' },
        ],
      },
    },
    events: {},
    attributes: {},
  }

  it('returns the old mapping if there is no new mapping present', () => {
    const expectedMapping = mergeMappings(oldMapping)

    expect(expectedMapping).toEqual(oldMapping)
  })

  it('merges the mappings using deepmerge if deepMerge parameter is present', () => {
    const mergedMapping = mergeMappings(oldMapping, newMapping, true)

    const expectedMapping = {
      elements: {
        text: {
          elementType: 'span',
        },
        picture: {
          elementType: 'picture',
          children: [
            { type: 'dynamic', content: { referenceType: 'children', id: 'children' } },
            { type: 'static', content: 'This browser does not support the image formats given' },
          ],
        },
      },
      events: {},
      attributes: {},
    }

    expect(mergedMapping).toEqual(expectedMapping)
  })

  it('merges the mapping using the spread operator ', () => {
    const mergedMapping = mergeMappings(oldMapping, newMapping)

    const expectedMapping = {
      elements: {
        text: {
          elementType: 'span',
        },
        picture: {
          elementType: 'picture',
          children: [
            { type: 'static', content: 'This browser does not support the image formats given' },
          ],
        },
      },
      events: {},
      attributes: {},
    }

    expect(mergedMapping).toEqual(expectedMapping)
  })
})
