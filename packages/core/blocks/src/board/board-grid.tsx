import type { TileData } from "@miragon/pulse-board"
import { CounterTile } from "./counter-tile.js"
import { IncidentListTile } from "./incident-list-tile.js"
import { IncidentSummaryTile } from "./incident-summary-tile.js"
import { InstanceListTile } from "./instance-list-tile.js"
import { ProcessDiagramTile } from "./process-diagram-tile.js"
import { RefusedTile } from "./refused-tile.js"
import type { BoardSlots } from "./slots.js"

export interface BoardTileProps {
  readonly tile: TileData
  readonly slots: BoardSlots
}

/** One tile of a board by its kind, a widget the file breaks in its place. */
export function BoardTile({ tile, slots }: BoardTileProps) {
  switch (tile.kind) {
    case "counter":
      return <CounterTile tile={tile} slots={slots} />
    case "instanceList":
      return <InstanceListTile tile={tile} slots={slots} />
    case "incidentSummary":
      return <IncidentSummaryTile tile={tile} slots={slots} />
    case "processDiagram":
      return <ProcessDiagramTile tile={tile} slots={slots} />
    case "incidentList":
      return <IncidentListTile tile={tile} slots={slots} />
    case "refused":
      return <RefusedTile tile={tile} slots={slots} />
  }
}

export interface BoardGridProps {
  /** The board's rows of tiles, in the board's JSON form. */
  readonly rows: readonly (readonly TileData[])[]
  readonly slots: BoardSlots
}

/**
 * A board's rows of tiles: a row's tiles side by side, one under the other in a container under
 * 760 px. The grid is its own container (`@container/board`), so it fits the surface's width.
 */
export function BoardGrid({ rows, slots }: BoardGridProps) {
  return (
    <div className="@container/board flex min-w-0 flex-col gap-3">
      {rows.map((row, index) => (
        <div
          className="grid min-w-0 auto-cols-[minmax(0,1fr)] grid-flow-col gap-3 @max-[760px]/board:grid-flow-row"
          key={index}
        >
          {row.map((tile, column) => (
            <BoardTile key={column} tile={tile} slots={slots} />
          ))}
        </div>
      ))}
    </div>
  )
}
