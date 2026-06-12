/**
 * Generates the TqKanban wrapper component source code.
 *
 * The component wraps @asseinfo/react-kanban via `next/dynamic` with
 * `ssr: false` — the library touches `window` at module load, so a plain
 * import crashes server-side rendering.
 *
 * The board prop accepts the platform's kanban-board contract (an object or
 * a JSON string with { columns: [{ id, title, cards: [{ id, title,
 * description? }] }] }), normalizes it defensively (the AI or a state binding
 * may deliver malformed payloads) and remounts the uncontrolled Board when
 * the board data changes (e.g. populated by a page-load workflow).
 */
export const generateKanbanComponentCode = (): string => {
  return `import React, { useMemo } from 'react'
import dynamic from 'next/dynamic'

const Board = dynamic(() => import('@asseinfo/react-kanban'), {
  ssr: false,
  loading: () => <div />,
})

const EMPTY_BOARD = { columns: [] }

const normalizeBoard = (value) => {
  let board = value
  if (typeof board === 'string') {
    try {
      board = JSON.parse(board)
    } catch (error) {
      board = null
    }
  }

  if (!board || typeof board !== 'object' || !Array.isArray(board.columns)) {
    return EMPTY_BOARD
  }

  return {
    columns: board.columns
      .filter((column) => column && typeof column === 'object' && !Array.isArray(column))
      .map((column, columnIndex) => ({
        id: column.id != null ? column.id : 'column-' + (columnIndex + 1),
        title: typeof column.title === 'string' ? column.title : 'Column ' + (columnIndex + 1),
        cards: (Array.isArray(column.cards) ? column.cards : [])
          .filter((card) => card && typeof card === 'object' && !Array.isArray(card))
          .map((card, cardIndex) => ({
            id: card.id != null ? card.id : 'card-' + (columnIndex + 1) + '-' + (cardIndex + 1),
            title: typeof card.title === 'string' ? card.title : 'Card',
            description: typeof card.description === 'string' ? card.description : undefined,
          })),
      })),
  }
}

const TqKanban = ({ board, disableColumnDrag = false, disableCardDrag = false, ...rest }) => {
  const normalizedBoard = useMemo(() => normalizeBoard(board), [board])
  // The Board is uncontrolled (initialBoard is read once) — remount it
  // whenever the board data actually changes, e.g. after a page-load workflow
  // replaces the state-bound board.
  const revision = useMemo(() => JSON.stringify(normalizedBoard), [normalizedBoard])

  return (
    <div {...rest}>
      <Board
        key={revision}
        initialBoard={normalizedBoard}
        disableColumnDrag={disableColumnDrag}
        disableCardDrag={disableCardDrag}
      />
    </div>
  )
}

export default TqKanban
`
}
