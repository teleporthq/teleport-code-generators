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
  UIDLElementNodeReferenceStyles,
  UIDLStyleMediaQueryScreenSizeCondition,
} from '@teleporthq/teleport-types'

export const resolveReferencedStyle = (input: ComponentUIDL) => {
  input.node = sortReferencedStylesOnElement(input.node)
}

const sortReferencedStylesOnElement = (node: UIDLElementNode) => {
  const { referencedStyles = {} } = node.content

  if (Object.keys(referencedStyles).length > 0) {
    const projectReferencedStyles: Record<string, UIDLElementNodeProjectReferencedStyle> = {}
    const inlineStyles: Record<string, UIDLElementNodeInlineReferencedStyle> = {}
    Object.values(referencedStyles).forEach((styleRef) => {
      const { content, id } = styleRef
      if (content.mapType === 'project-referenced') {
        projectReferencedStyles[id] = styleRef as UIDLElementNodeProjectReferencedStyle
      }

      if (content.mapType === 'inlined') {
        inlineStyles[id] = styleRef as UIDLElementNodeInlineReferencedStyle
      }
    })
    node.content.referencedStyles = {
      ...sortByStateAndCondition(inlineStyles),
      ...sortByStateAndCondition(projectReferencedStyles),
    }
  }

  node.content?.children?.map((child) => {
    if (child.type === 'element') {
      sortReferencedStylesOnElement(child)
    }

    if (child.type === 'repeat') {
      sortReferencedStylesOnElement(child.content.node)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      sortReferencedStylesOnElement(child.content.node)
    }

    return child
  })
  return node
}

const sortByStateAndCondition = (styles: UIDLReferencedStyles) => {
  if (Object.keys(styles).length === 0) {
    return {}
  }
  const allMediaRelatedStyles: Record<string, UIDLElementNodeInlineReferencedStyle> = {}

  const list: UIDLReferencedStyles = Object.values(styles).reduce(
    (acc: UIDLReferencedStyles, styleRef: UIDLElementNodeReferenceStyles) => {
      if (
        styleRef.content.mapType === 'inlined' &&
        styleRef.content.conditions?.[0].conditionType === 'screen-size'
      ) {
        allMediaRelatedStyles[styleRef.id] = styleRef as UIDLElementNodeInlineReferencedStyle
      } else {
        acc[styleRef.id] = styleRef
      }
      return acc
    },
    {}
  )

  const sortedMediaQueries: Record<string, UIDLElementNodeReferenceStyles> = Object.values(
    allMediaRelatedStyles
  )
    .sort(
      (a, b) =>
        (a.content.conditions[0] as UIDLStyleMediaQueryScreenSizeCondition).maxWidth -
        (b.content.conditions[0] as UIDLStyleMediaQueryScreenSizeCondition).maxWidth
    )
    .reverse()
    .reduce((acc: UIDLReferencedStyles, item: UIDLElementNodeReferenceStyles) => {
      acc[item.id] = item
      return acc
    }, {})

  return { ...list, ...sortedMediaQueries }
}
