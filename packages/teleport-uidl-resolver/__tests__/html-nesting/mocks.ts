import {
  ComponentUIDL,
  GeneratorOptions,
  UIDLElementNode,
  UIDLNode,
  UIDLStyleSetDefinition,
  UIDLStyleSheetContent,
} from '@teleporthq/teleport-types'

/**
 * The nesting resolver runs on an ALREADY MAPPED tree, so these mocks are
 * written with the final tag in `elementType` — exactly the shape
 * `utils.resolveNode` leaves behind.
 */
export const element = (
  elementType: string,
  children: UIDLNode[] = [],
  content: Partial<UIDLElementNode['content']> = {}
): UIDLElementNode => ({
  type: 'element',
  content: {
    elementType,
    children,
    ...content,
  },
})

export const text = (content: string): UIDLNode => ({ type: 'static', content })

export const component = (node: UIDLElementNode, name = 'Homepage'): ComponentUIDL =>
  ({ name, node } as ComponentUIDL)

/** A node-level `referencedStyles` entry pointing at a project style set. */
export const referencingProjectStyle = (
  referenceId: string
): Partial<UIDLElementNode['content']> => ({
  referencedStyles: {
    [referenceId]: {
      type: 'style-map',
      content: { mapType: 'project-referenced', referenceId },
    },
  },
})

export const optionsWithProjectStyles = (
  styleSetDefinitions: Record<string, UIDLStyleSetDefinition>
): GeneratorOptions => ({
  projectStyleSet: { styleSetDefinitions, fileName: 'style', path: '.' },
})

export const staticStyleSet = (declarations: Record<string, string>): UIDLStyleSetDefinition => {
  const content: Record<string, UIDLStyleSheetContent> = {}
  Object.keys(declarations).forEach((property) => {
    content[property] = { type: 'static', content: declarations[property] }
  })
  return { type: 'reusable-project-style-map', content }
}

/** The `elementType` of every element in the tree, in depth-first order. */
export const tagsOf = (node: UIDLNode, tags: string[] = []): string[] => {
  if (node.type === 'element') {
    tags.push(node.content.elementType)
    ;(node.content.children || []).forEach((child) => tagsOf(child, tags))
  }
  return tags
}
