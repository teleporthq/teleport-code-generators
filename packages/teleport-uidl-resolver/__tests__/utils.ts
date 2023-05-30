import {
  staticNode,
  repeatNode,
  elementNode,
  dynamicNode,
  component,
  definition,
  element,
} from '@teleporthq/teleport-uidl-builders'
import {
  generateUniqueKeys,
  createNodesLookup,
  resolveChildren,
  ensureDataSourceUniqueness,
  mergeMappings,
  checkForIllegalNames,
  checkForDefaultPropsContainingAssets,
  checkForDefaultStateValueContainingAssets,
  resolveElement,
  parseStaticStyles,
  prefixAssetURLs,
} from '../src/utils'
import {
  UIDLElement,
  UIDLNode,
  UIDLRepeatNode,
  Mapping,
  UIDLStyleDefinitions,
} from '@teleporthq/teleport-types'
import mapping from './mapping.json'

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
    const elementSample = elementNode('container', {}, [repeatNodeSample, repeatNodeSample1])

    ensureDataSourceUniqueness(elementSample)
    const firstRepeat = elementSample.content.children[0] as UIDLRepeatNode
    const secondRepeat = elementSample.content.children[1] as UIDLRepeatNode

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
    const innerChildren = (result[0].content as unknown as UIDLElement).children
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
    const innerChildren = (result[0].content as unknown as UIDLElement).children
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
    const innerChildren = (result[0].content as unknown as UIDLElement).children
    expect(innerChildren.length).toBe(5)
    expect(innerChildren[0].content).toBe('original-text')
    expect(innerChildren[1].content).toBe('other-original-text')
    expect(innerChildren[2].content).toBe('remains here')
    expect(innerChildren[3].content).toBe('original-text')
    expect(innerChildren[4].content).toBe('other-original-text')
  })
})

describe('mergeMappings', () => {
  const oldMapping: Mapping = {
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
    illegalClassNames: [],
    illegalPropNames: ['title'],
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
    const expectedMapping = mergeMappings(oldMapping as Mapping)

    expect(expectedMapping).toEqual(oldMapping)
  })

  it('merges the mappings using deepmerge if deepMerge parameter is present', () => {
    const mergedMapping = mergeMappings(oldMapping as Mapping, newMapping as Mapping, true)

    const expectedMapping: Mapping = {
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
      illegalClassNames: [],
      illegalPropNames: ['title'],
    }

    expect(mergedMapping).toEqual(expectedMapping)
  })

  it('merges the mapping using the spread operator ', () => {
    const mergedMapping = mergeMappings(oldMapping as Mapping, newMapping as Mapping)

    const expectedMapping: Mapping = {
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
      illegalClassNames: [],
      illegalPropNames: ['title'],
    }

    expect(mergedMapping).toEqual(expectedMapping)
  })
})

describe('checkForIllegalNames', () => {
  const comp = component(
    'Component',
    elementNode('container'),
    {
      'my-title': definition('string', 'test'),
    },
    {
      isVisible: definition('boolean', false),
    }
  )

  comp.outputOptions = {
    componentClassName: 'Component',
    fileName: 'component',
  }

  it('checks component name', () => {
    checkForIllegalNames(comp, mapping)
    expect(comp.outputOptions.componentClassName).toBe('AppComponent')
  })

  it('handles empty string', () => {
    comp.outputOptions = {
      componentClassName: '',
      fileName: 'component',
    }

    checkForIllegalNames(comp, mapping)

    expect(comp.outputOptions.componentClassName).toBe('App')
  })

  it('throws error for invalid prop', () => {
    comp.propDefinitions.this = definition('string', '')

    expect(() => checkForIllegalNames(comp, mapping)).toThrowError()
  })
})

describe('checkForDefaultPropsContainingAssets', () => {
  const comp = component('Component', elementNode('image'), {
    myImage: {
      type: 'string',
      defaultValue: '/kittens.png',
    },
  })

  const assets = {
    prefix: 'public',
    identifier: 'assets',
    mappings: { 'kittens.png': 'sub1/sub2' },
  }

  it('find and fix defaultProp containing an asset', () => {
    checkForDefaultPropsContainingAssets(comp, assets)
    expect(comp.propDefinitions).toBeDefined()
    if (comp.propDefinitions) {
      expect(comp.propDefinitions.myImage).toBeDefined()
      expect(comp.propDefinitions.myImage.defaultValue).toContain(
        'public/assets/sub1/sub2/kittens.png'
      )
    }
  })
})

describe('checkForDefaultStateValueContainingAssets', () => {
  const comp = component(
    'Component',
    elementNode('image'),
    {
      myImage: {
        type: 'string',
        defaultValue: '/kittens.png',
      },
    },
    {
      imageState: {
        type: 'string',
        defaultValue: '/dogs.png',
      },
    }
  )

  const assets = {
    prefix: 'public',
    identifier: 'assets',
    mappings: {
      'kittens.png': 'sub1/sub2',
      'dogs.png': 'dog/pictures',
    },
  }

  it('find and fix defaultProp containing an asset', () => {
    checkForDefaultStateValueContainingAssets(comp, assets)
    expect(comp.stateDefinitions).toBeDefined()
    if (comp.stateDefinitions) {
      expect(comp.stateDefinitions.imageState).toBeDefined()
      expect(comp.stateDefinitions.imageState.defaultValue).toContain(
        'public/assets/dog/pictures/dogs.png'
      )
    }
  })
})

describe('resolveLinkElement', () => {
  const assets = {
    prefix: 'public',
    identifier: 'assets',
    mappings: {
      'kittens.png': 'sub1/sub2',
      'dogs.png': 'dog/pictures',
    },
  }
  const genereicMapping: Mapping = {
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
    illegalClassNames: [],
    illegalPropNames: ['title'],
  }
  const linkElement = element('Link', {
    url: staticNode('/test'),
  })

  const linkHTMLElement = element('a', {
    url: staticNode('/test'),
  })

  const assetElement = element('image', {
    src: staticNode('/kittens.png'),
  })

  it('resolve link element', () => {
    resolveElement(linkElement, { assets, mapping: genereicMapping })
    expect(linkElement.attrs?.url.content).toBe('/test')
  })
  it('resolve link html element', () => {
    resolveElement(linkHTMLElement, { assets, mapping: genereicMapping })
    expect(linkHTMLElement.attrs?.url.content).toBe('/test')
  })
  it('resolve image element', () => {
    resolveElement(assetElement, { assets, mapping: genereicMapping })
    expect(assetElement.attrs?.src.content).toBe('public/assets/sub1/sub2/kittens.png')
  })
})

describe('parseBackgroundWithMultipleStyles', () => {
  const styleToParse: UIDLStyleDefinitions = {
    backgroundImage: {
      type: 'static',
      content:
        'linear-gradient(90deg, rgb(189, 195, 199) 0.00%,rgba(44, 62, 80, 0.5) 100.00%),url("/kittens.png")',
    },
  }

  const assets = {
    prefix: 'public',
    identifier: 'assets',
    mappings: {
      'kittens.png': 'sub1/sub2',
      'dogs.png': 'dog/pictures',
    },
  }
  it('correctly splits the style content into two separate styles', () => {
    const parsedStyle = parseStaticStyles(styleToParse.backgroundImage.content as string)
    expect(parsedStyle).toBeDefined()
    expect(parsedStyle.length).toBe(2)
    expect(parsedStyle[0]).toBe(
      'linear-gradient(90deg, rgb(189, 195, 199) 0.00%,rgba(44, 62, 80, 0.5) 100.00%)'
    )
    expect(parsedStyle[1]).toBe('url("/kittens.png")')
  })

  it('correctly generates background image style with correct url', () => {
    const parsedStyle = prefixAssetURLs(styleToParse, assets)
    expect(parsedStyle.backgroundImage).toBeDefined()
    expect(parsedStyle.backgroundImage.content).toBeDefined()
    if (parsedStyle.backgroundImage.content) {
      expect(parsedStyle.backgroundImage.content).toContain(
        'linear-gradient(90deg, rgb(189, 195, 199) 0.00%,rgba(44, 62, 80, 0.5) 100.00%),url("public/assets/sub1/sub2/kittens.png")'
      )
    }
  })
})
