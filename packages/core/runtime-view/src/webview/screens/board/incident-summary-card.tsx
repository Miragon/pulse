import { Button } from "@miragon/pulse-ui"
import type {
  BoardTarget,
  IncidentSummaryRowData,
  IncidentSummaryTile,
} from "../../../core/protocol/index.js"
import { EmptyHint } from "../../components/empty-hint.js"
import {
  BOARD_LINE,
  BOARD_LINE_BUTTON,
  BoardCard,
  BoardFigure,
  type BoardCallbacks,
} from "./board-card.js"
import { BoardLabels } from "./board-labels.js"

export interface IncidentSummaryCardProps extends Pick<BoardCallbacks, "onOpen"> {
  readonly tile: IncidentSummaryTile
}

interface RowProps {
  readonly row: IncidentSummaryRowData
  readonly byProcess: boolean
}

interface SummaryRowProps extends RowProps, Pick<BoardCallbacks, "onOpen"> {
  readonly target: BoardTarget | undefined
}

function RowText({ row, byProcess }: RowProps) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{BoardLabels.summaryLabel(row)}</span>
      {byProcess && <span className="text-muted-foreground">{row.engine}</span>}
      <BoardFigure
        text={BoardLabels.entryCount(
          row.withIncident === undefined ? undefined : { count: row.withIncident },
        )}
        alarm={row.withIncident !== undefined && row.withIncident > 0}
        quiet={row.withIncident === undefined}
      />
    </>
  )
}

function SummaryRow({ row, byProcess, target, onOpen }: SummaryRowProps) {
  return (
    <li>
      {row.withIncident === undefined || target === undefined ? (
        <span className={BOARD_LINE}>
          <RowText row={row} byProcess={byProcess} />
        </span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={BOARD_LINE_BUTTON}
          title={BoardLabels.openTitle(target)}
          onClick={(event) => {
            onOpen(target, event.ctrlKey || event.metaKey)
          }}
        >
          <RowText row={row} byProcess={byProcess} />
        </Button>
      )}
    </li>
  )
}

export function IncidentSummaryCard({ tile, onOpen }: IncidentSummaryCardProps) {
  const partial = BoardLabels.partial(tile)
  const byProcess = tile.widget.groupBy === "process"
  return (
    <BoardCard title={BoardLabels.title(tile)} kind="incidentSummary">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BoardFigure
          text={BoardLabels.count(tile.total === undefined ? undefined : { count: tile.total })}
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
              key={`${row.engine}|${row.process?.bpmnProcessId ?? ""}`}
              row={row}
              byProcess={byProcess}
              target={tile.targets.find(
                (target) =>
                  target.engine === row.engine &&
                  target.bpmnProcessId === row.process?.bpmnProcessId,
              )}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </BoardCard>
  )
}
