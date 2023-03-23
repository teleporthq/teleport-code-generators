/*
  Referenced styles contains both media queries and pseudo styles,
  we need to sort out the media queries. So, we generate them as desktop irst approach
  In this resolver, we parse through these styles on all the nodes and sort them.
  All the media-queries that are inlined are sorted in descending order.
*/

import {
  UIDLElementNode,
  ComponentUIDL,
  UIDLElementNodeProjectReferencedStyle,
  UIDLElementNodeInlineReferencedStyle,
  UIDLReferencedStyles,
  UIDLStyleMediaQueryScreenSizeCondition,
  UIDLElementNodeCompReferencedStyle,
  GeneratorOptions,
} from '@teleporthq/teleport-types'
import { prefixAssetURLs } from '../../utils'

export const resolveReferencedStyle = (input: ComponentUIDL, options: GeneratorOptions) => {
  input.node = sortReferencedStylesOnElement(input.node, options)
}

const sortReferencedStylesOnElement = (node: UIDLElementNode, options: GeneratorOptions) => {
  const { referencedStyles = {} } = node.content

  if (Object.keys(referencedStyles).length > 0) {
    node.content.referencedStyles = sortByStateAndCondition(referencedStyles, options)
  }

  node.content?.children?.map((child) => {
    if (child.type === 'element') {
      sortReferencedStylesOnElement(child, options)
    }

    if (child.type === 'repeat') {
      sortReferencedStylesOnElement(child.content.node, options)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      sortReferencedStylesOnElement(child.content.node, options)
    }

    return child
  })
  return node
}

const sortByStateAndCondition = (
  styles: UIDLReferencedStyles,
  options: GeneratorOptions
): UIDLReferencedStyles => {
  if (Object.keys(styles).length === 0) {
    return {}
  }

  const allMediaRelatedStyles: Record<string, UIDLElementNodeInlineReferencedStyle> = {}
  const allElementStateRelatedStyles: Record<string, UIDLElementNodeInlineReferencedStyle> = {}
  const globalReferencedStyles: Record<string, UIDLElementNodeProjectReferencedStyle> = {}
  const allClassReferencedStyles: Record<string, UIDLElementNodeCompReferencedStyle> = {}

  Object.keys(styles).map((styleId: string) => {
    const styleRef = styles[styleId]

    switch (styleRef.content.mapType) {
      case 'inlined':
        {
          if (styleRef.content.conditions[0].conditionType === 'screen-size') {
            allMediaRelatedStyles[styleId] = {
              ...styleRef,
              content: {
                ...styleRef.content,
                styles: prefixAssetURLs(styleRef.content.styles, options?.assets),
              },
            }
          }

          if (styleRef.content.conditions[0].conditionType === 'element-state') {
            allElementStateRelatedStyles[styleId] = {
              ...styleRef,
              content: {
                ...styleRef.content,
                styles: prefixAssetURLs(styleRef.content.styles, options?.assets),
              },
            }
          }
        }
        break
      case 'component-referenced': {
        allClassReferencedStyles[styleId] = styleRef as UIDLElementNodeCompReferencedStyle
        break
      }
      case 'project-referenced': {
        globalReferencedStyles[styleId] = styleRef as UIDLElementNodeProjectReferencedStyle
        break
      }
      default: {
        throw new Error(
          `Invalid referenceStyle passed - ${JSON.stringify(styleRef.content, null, 2)}`
        )
      }
    }
  })

  const sortedMediaQueries: Record<string, UIDLElementNodeInlineReferencedStyle> = Object.keys(
    allMediaRelatedStyles
  )
    .sort((a, b) => {
      const styleA = allMediaRelatedStyles[a]
      const styleB = allMediaRelatedStyles[b]

      return (
        (styleB.content.conditions[0] as UIDLStyleMediaQueryScreenSizeCondition).maxWidth -
        (styleA.content.conditions[0] as UIDLStyleMediaQueryScreenSizeCondition).maxWidth
      )
    })
    .reduce((acc: Record<string, UIDLElementNodeInlineReferencedStyle>, styleId: string) => {
      acc[styleId] = allMediaRelatedStyles[styleId]
      return acc
    }, {})

  return {
    ...globalReferencedStyles,
    ...allClassReferencedStyles,
    ...sortedMediaQueries,
    ...allElementStateRelatedStyles,
  }
}
