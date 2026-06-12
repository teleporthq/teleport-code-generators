import { ProjectPluginStructure, UIDLElement, UIDLNode } from '@teleporthq/teleport-types'

/**
 * Traverses a UIDL node tree and calls `fn` for every UIDLElement found.
 * Handles element nodes, conditionals, repeats, slots, CMS nodes, and
 * data-source nodes.
 */
export const traverseElements = (node: UIDLNode, fn: (element: UIDLElement) => void) => {
  if (!node || !node.type) {
    return
  }

  switch (node.type) {
    case 'element': {
      const content = node.content as UIDLElement
      fn(content)

      if (content.children) {
        for (const child of content.children) {
          traverseElements(child, fn)
        }
      }

      if (content.attrs) {
        for (const attrKey of Object.keys(content.attrs)) {
          const attrValue = content.attrs[attrKey]
          if (attrValue.type === 'element') {
            traverseElements(attrValue, fn)
          }
        }
      }
      break
    }

    case 'repeat':
      traverseElements((node.content as any).node, fn)
      break

    case 'conditional':
      traverseElements((node.content as any).node, fn)
      if ((node.content as any).fallback) {
        traverseElements((node.content as any).fallback, fn)
      }
      break

    case 'slot':
      if ((node.content as any).fallback) {
        traverseElements((node.content as any).fallback, fn)
      }
      break

    case 'cms-item':
    case 'cms-list':
    case 'cms-mixed-type':
      if ((node.content as any).nodes?.success) {
        traverseElements((node.content as any).nodes.success, fn)
      }
      if ((node.content as any).nodes?.error) {
        traverseElements((node.content as any).nodes.error, fn)
      }
      if ((node.content as any).nodes?.loading) {
        traverseElements((node.content as any).nodes.loading, fn)
      }
      break

    case 'cms-list-repeater':
      if ((node.content as any).nodes?.list) {
        traverseElements((node.content as any).nodes.list, fn)
      }
      if ((node.content as any).nodes?.empty) {
        traverseElements((node.content as any).nodes.empty, fn)
      }
      if ((node.content as any).nodes?.loading) {
        traverseElements((node.content as any).nodes.loading, fn)
      }
      break

    case 'data-source-item':
    case 'data-source-list':
      if ((node.content as any).nodes?.success) {
        traverseElements((node.content as any).nodes.success, fn)
      }
      if ((node.content as any).nodes?.error) {
        traverseElements((node.content as any).nodes.error, fn)
      }
      if ((node.content as any).nodes?.loading) {
        traverseElements((node.content as any).nodes.loading, fn)
      }
      if ((node.content as any).children) {
        for (const child of (node.content as any).children) {
          traverseElements(child, fn)
        }
      }
      break

    default:
      break
  }
}

/**
 * Scans all pages and components in the project UIDL and calls `fn` for
 * every UIDLElement found anywhere in the project.
 */
export const traverseProjectElements = (
  uidl: ProjectPluginStructure['uidl'],
  fn: (element: UIDLElement) => void
) => {
  if (uidl.root?.node) {
    traverseElements(uidl.root.node, fn)
  }

  if (uidl.components) {
    for (const componentName of Object.keys(uidl.components)) {
      const component = uidl.components[componentName]
      if (component?.node) {
        traverseElements(component.node, fn)
      }
    }
  }
}

/**
 * Returns true when any element in the project UIDL has one of the given
 * element/semantic types. Used by project plugins to detect primitive usage.
 */
export const projectUsesElementTypes = (
  uidl: ProjectPluginStructure['uidl'],
  elementTypes: Set<string>
): boolean => {
  let found = false
  traverseProjectElements(uidl, (element) => {
    if (
      elementTypes.has(element.elementType) ||
      (element.semanticType && elementTypes.has(element.semanticType))
    ) {
      found = true
    }
  })
  return found
}
