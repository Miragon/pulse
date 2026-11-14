import { Button } from "@miragon/pulse-ui"
import type { IncidentSummaryRow, IncidentSummaryTile } from "../../../core/protocol/index.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { BOARD_LINE, BOARD_LINE_BUTTON, BoardCard, BoardFigure } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"
import { useOpenTarget } from "./open-target.js"

interface RowProps {
  readonly row: IncidentSummaryRow
  readonly byProcess: boolean
}

function RowText({ row, byProcess }: RowProps) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {byProcess && <span className="text-muted-foreground">{row.engine}</span>}
      <BoardFigure
        text={BoardLabels.entryCount(row.withIncident)}
        alarm={row.withIncident !== undefined && row.withIncident > 0}
        quiet={row.withIncident === undefined}
      />
    </>
  )
}

function SummaryRow({ row, byProcess }: RowProps) {
  const open = useOpenTarget()
  return (
    <li>
      {row.withIncident === undefined ? (
        <span className={BOARD_LINE}>
          <RowText row={row} byProcess={byProcess} />
        </span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={BOARD_LINE_BUTTON}
          title={BoardLabels.openTitle(row.target)}
          onClick={(event) => {
            open(row.target, event.ctrlKey || event.metaKey)
          }}
        >
          <RowText row={row} byProcess={byProcess} />
        </Button>
      )}
    </li>
  )
}

export function IncidentSummaryCard({ tile }: { readonly tile: IncidentSummaryTile }) {
  const partial = BoardLabels.partial(tile)
  const byProcess = tile.groupBy === "process"
  return (
    <BoardCard title={tile.title} kind="incidentSummary">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BoardFigure
          text={BoardLabels.count(tile.total)}
          part="counter-value"
          alarm={tile.total !== undefined && tile.total > 0}
          className="text-title"
        />
        {partial !== undefined && (
          <span className="text-muted-foreground" data-part="counter-partial">
            {partial}
          </span>
        )}
      </p>
      {tile.rows.length === 0 ? (
        <EmptyHint
          text={tile.known === 0 ? "No engine was read." : "No instance has an open incident."}
        />
      ) : (
        <ul className="flex flex-col" aria-label={byProcess ? "Per process" : "Per engine"}>
          {tile.rows.map((row) => (
            <SummaryRow
              key={`${row.engine}|${row.target.bpmnProcessId ?? ""}`}
              row={row}
              byProcess={byProcess}
            />
          ))}
        </ul>
      )}
    </BoardCard>
  )
}
