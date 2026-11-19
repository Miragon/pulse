// Pulse's building blocks: React on @miragon/pulse-ui, props and callbacks only, no host and no
// React context of their own. The surface brings its table, its id and its diagram as slots.
export {
  BoardGrid,
  BoardTile,
  type BoardGridProps,
  type BoardTileProps,
} from "./board/board-grid.js"
export { useNoteLines, useProblemWords } from "./board/problem-words.js"
export { ProblemList, type ProblemLine, type ProblemListProps } from "./board/refused-tile.js"
export type {
  BoardCopy,
  BoardDiagramProps,
  BoardIdProps,
  BoardInstanceTarget,
  BoardInstancesTarget,
  BoardListFilter,
  BoardOpenHow,
  BoardScope,
  BoardSlots,
  BoardTableColumn,
  BoardTableProps,
  BoardTableSlot,
  BoardTarget,
} from "./board/slots.js"
