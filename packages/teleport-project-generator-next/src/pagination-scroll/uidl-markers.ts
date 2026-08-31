import { ProjectPluginStructure, UIDLElement } from '@teleporthq/teleport-types'
import { traverseProjectElements } from '../uidl-element-traversal'
import {
  LIST_CHROME_ATTR,
  LIST_CONTROLS_ELEMENT_TYPE,
  PAGINATION_ATTR,
  PAGINATION_ELEMENT_TYPE,
} from './constants'

/**
 * Adds a static `data-*` attribute to a UIDL element, leaving an existing one
 * (an author could have typed the same attribute by hand) untouched.
 */
const stampMarker = (element: UIDLElement, attribute: string): void => {
  if (!element.attrs) {
    element.attrs = {}
  }
  if (element.attrs[attribute]) {
    return
  }
  element.attrs[attribute] = { type: 'static', content: 'true' }
}

/**
 * Does the element carry the marker the runtime delegates off?
 *
 * Checked instead of the element type in `runAfter`, because by then the UIDL
 * has been through the resolver: `cms-pagination-node` has become its
 * `semanticType` (`div`) and only the marker we stamped in `runBefore` is still
 * a stable identifier.
 */
const isMarkedPaginationNode = (element: UIDLElement): boolean =>
  Boolean(element.attrs && element.attrs[PAGINATION_ATTR])

/**
 * Stamps the runtime's markers onto every array-mapper pagination block in the
 * project, and reports whether there was at least one.
 *
 * Collected first and stamped second so a project WITHOUT pagination gets no
 * attributes at all — the list-controls marker only earns its bytes next to a
 * pagination block that will actually be scrolled.
 */
export const markPaginationNodesInProject = (uidl: ProjectPluginStructure['uidl']): boolean => {
  const paginationNodes: UIDLElement[] = []
  const listControlNodes: UIDLElement[] = []

  traverseProjectElements(uidl, (element) => {
    if (element.elementType === PAGINATION_ELEMENT_TYPE) {
      paginationNodes.push(element)
    } else if (element.elementType === LIST_CONTROLS_ELEMENT_TYPE) {
      listControlNodes.push(element)
    }
  })

  if (paginationNodes.length === 0) {
    return false
  }

  paginationNodes.forEach((element) => stampMarker(element, PAGINATION_ATTR))
  listControlNodes.forEach((element) => stampMarker(element, LIST_CHROME_ATTR))

  return true
}

/** True once `markPaginationNodesInProject` has stamped at least one node. */
export const projectHasPaginationMarkers = (uidl: ProjectPluginStructure['uidl']): boolean => {
  let found = false
  traverseProjectElements(uidl, (element) => {
    if (!found && isMarkedPaginationNode(element)) {
      found = true
    }
  })
  return found
}
