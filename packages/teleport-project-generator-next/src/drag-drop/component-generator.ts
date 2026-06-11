/**
 * Generates the drag-and-drop wrapper components source code (dnd-kit based).
 *
 * One file exports all primitives:
 *  - TqDragArea:     DndContext boundary; tracks which droppable zone each
 *                    draggable was dropped into
 *  - TqDraggable:    draggable wrapper; when dropped into a zone it renders
 *                    into that zone's DOM node via a portal (its React subtree
 *                    never re-parents, so children/state keep working)
 *  - TqDroppable:    drop zone; registers its DOM node with the area and
 *                    highlights while a draggable hovers it
 *  - TqSortable:     self-contained sortable list; reorders its direct
 *                    children on drag (vertical or horizontal)
 *  - TqSortableItem: plain styling wrapper for a sortable entry
 *
 * React 17 compatible on purpose: no useId / useSyncExternalStore — projects
 * only get React 18 when other primitives (e.g. the calendar) require it.
 * dnd-kit is SSR-safe, so plain imports are fine in Next.js pages.
 */
export const generateDragDropComponentCode = (): string => {
  return `import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const DragAreaContext = createContext(null)

// Stable auto-ids without React 18's useId. Ids never reach the DOM (dnd-kit
// keeps them in its internal registry), so server/client counters don't need
// to match.
let autoIdCounter = 0
const useStableId = (prefix, explicitId) => {
  const idRef = useRef(null)
  if (idRef.current === null) {
    autoIdCounter += 1
    idRef.current = prefix + '-auto-' + autoIdCounter
  }
  return explicitId || idRef.current
}

// Distance constraint keeps clicks on buttons/links inside draggables working.
const useDefaultSensors = () =>
  useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

export const TqDragArea = ({ children, ...rest }) => {
  const [assignments, setAssignments] = useState({})
  const [zoneNodes, setZoneNodes] = useState({})
  const sensors = useDefaultSensors()

  const registerZone = useCallback((id, node) => {
    setZoneNodes((prev) => {
      if (prev[id] === node) {
        return prev
      }
      const next = { ...prev }
      if (node) {
        next[id] = node
      } else {
        delete next[id]
      }
      return next
    })
  }, [])

  const handleDragEnd = useCallback(({ active, over }) => {
    if (!over) {
      return
    }
    setAssignments((prev) => ({ ...prev, [active.id]: over.id }))
  }, [])

  const contextValue = useMemo(
    () => ({ assignments, zoneNodes, registerZone }),
    [assignments, zoneNodes, registerZone]
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <DragAreaContext.Provider value={contextValue}>
        <div {...rest}>{children}</div>
      </DragAreaContext.Provider>
    </DndContext>
  )
}

const DraggableShell = ({ id, style, children, ...rest }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })

  const dragStyle = {
    ...style,
    transform: CSS.Translate.toString(transform),
    cursor: 'grab',
    touchAction: 'none',
    ...(isDragging ? { opacity: 0.6, position: 'relative', zIndex: 10 } : {}),
  }

  return (
    <div ref={setNodeRef} style={dragStyle} {...attributes} {...listeners} {...rest}>
      {children}
    </div>
  )
}

export const TqDraggable = ({ dragId, children, ...rest }) => {
  const id = useStableId('tq-draggable', dragId)
  const area = useContext(DragAreaContext)

  if (!area) {
    return <div {...rest}>{children}</div>
  }

  const content = (
    <DraggableShell id={id} {...rest}>
      {children}
    </DraggableShell>
  )

  const assignedZone = area.assignments[id]
  const targetNode = assignedZone !== undefined ? area.zoneNodes[assignedZone] : null
  if (targetNode) {
    return createPortal(content, targetNode)
  }

  return content
}

export const TqDroppable = ({ dropId, style, children, ...rest }) => {
  const id = useStableId('tq-droppable', dropId)
  const area = useContext(DragAreaContext)
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !area })

  const registerZone = area ? area.registerZone : null
  const combinedRef = useCallback(
    (node) => {
      setNodeRef(node)
      if (registerZone) {
        registerZone(id, node)
      }
    },
    [setNodeRef, registerZone, id]
  )

  const dropStyle = {
    ...style,
    ...(isOver ? { outline: '2px dashed #3b82f6', outlineOffset: '-2px' } : {}),
  }

  return (
    <div ref={combinedRef} style={dropStyle} {...rest}>
      {children}
    </div>
  )
}

const SortableEntry = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: 'grab',
    touchAction: 'none',
    ...(isDragging ? { opacity: 0.6, position: 'relative', zIndex: 10 } : {}),
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

export const TqSortable = ({ direction = 'vertical', children, ...rest }) => {
  const items = React.Children.toArray(children)
  // order[displayPosition] = original child index
  const [order, setOrder] = useState(() => items.map((_, index) => index))
  const sensors = useDefaultSensors()

  useEffect(() => {
    setOrder((prev) => (prev.length === items.length ? prev : items.map((_, index) => index)))
  }, [items.length])

  const safeOrder = order.length === items.length ? order : items.map((_, index) => index)
  const ids = safeOrder.map((itemIndex) => 'tq-sortable-entry-' + itemIndex)

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) {
      return
    }
    const oldPosition = ids.indexOf(active.id)
    const newPosition = ids.indexOf(over.id)
    if (oldPosition === -1 || newPosition === -1) {
      return
    }
    setOrder((prev) => arrayMove(prev, oldPosition, newPosition))
  }

  const strategy =
    direction === 'horizontal' ? horizontalListSortingStrategy : verticalListSortingStrategy

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={strategy}>
        <div {...rest}>
          {safeOrder.map((itemIndex) => (
            <SortableEntry key={itemIndex} id={'tq-sortable-entry-' + itemIndex}>
              {items[itemIndex]}
            </SortableEntry>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

export const TqSortableItem = ({ children, ...rest }) => {
  return <div {...rest}>{children}</div>
}
`
}
