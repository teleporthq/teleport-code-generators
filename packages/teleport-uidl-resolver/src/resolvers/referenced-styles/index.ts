import {
  UIDLElementNode,
  ComponentUIDL,
  UIDLElementNodeProjectReferencedStyle,
  UIDLElementNodeInlineReferencedStyle,
  UIDLReferencedStyles,
  UIDLelementNodeReferenceStyles,
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
  const allMediaRelatedStyles: UIDLReferencedStyles = {}
  const list: UIDLReferencedStyles = Object.values(styles).reduce(
    (acc: UIDLReferencedStyles, styleRef: UIDLelementNodeReferenceStyles) => {
      if (styleRef.content.conditions?.[0].conditionType === 'screen-size') {
        allMediaRelatedStyles[styleRef.id] = styleRef
      } else {
        acc[styleRef.id] = styleRef
      }
      return acc
    },
    {}
  )

  const sortedMediaQueries: UIDLReferencedStyles = Object.values(allMediaRelatedStyles)
    .sort(
      // @ts-ignore
      (a, b) => a.content.conditions?.[0].maxWidth - b.content.conditions?.[0].maxWidth
    )
    .reverse()
    .reduce((acc: UIDLReferencedStyles, item: UIDLelementNodeReferenceStyles) => {
      acc[item.id] = item
      return acc
    }, {})

  return { ...list, ...sortedMediaQueries }
}
