import { Button } from "@miragon/pulse-ui"
import type { IncidentSummaryData, IncidentSummaryRowData } from "@miragon/pulse-board"
import { useWords } from "../messages/translate.js"
import { BOARD_LINE, BOARD_LINE_BUTTON, BoardCard, BoardFigure, EmptyNote } from "./board-card.js"
import type { BoardSlots } from "./slots.js"
import { openable, summaryTarget } from "./targets.js"
import {
  entryCount,
  openTitle,
  partial,
  summaryLabel,
  tileTitle,
  totalCount,
} from "./tile-words.js"

export interface IncidentSummaryTileProps {
  readonly tile: IncidentSummaryData
  readonly slots: Pick<BoardSlots, "onOpen" | "opens" | "opensToSide">
}

interface RowProps {
  readonly row: IncidentSummaryRowData
  readonly byProcess: boolean
}

interface SummaryRowProps extends RowProps {
  readonly slots: IncidentSummaryTileProps["slots"]
}

function RowText({ row, byProcess }: RowProps) {
  const t = useWords()
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{summaryLabel(row)}</span>
      {byProcess && <span className="text-muted-foreground">{row.engine}</span>}
      <BoardFigure
        text={entryCount(
          t,
          row.withIncident === undefined ? undefined : { count: row.withIncident },
        )}
        alarm={row.withIncident !== undefined && row.withIncident > 0}
        quiet={row.withIncident === undefined}
      />
    </>
  )
}

function SummaryRow({ row, byProcess, slots }: SummaryRowProps) {
  const t = useWords()
  const target = row.withIncident === undefined ? undefined : openable(slots, summaryTarget(row))
  if (target === undefined) {
    return (
      <li>
        <span className={BOARD_LINE}>
          <RowText row={row} byProcess={byProcess} />
        </span>
      </li>
    )
  }
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={BOARD_LINE_BUTTON}
        title={openTitle(t, target, slots.opensToSide === true)}
        onClick={(event) => {
          slots.onOpen(target, { toSide: event.ctrlKey || event.metaKey })
        }}
      >
        <RowText row={row} byProcess={byProcess} />
      </Button>
    </li>
  )
}

/** The instances with incident per process or per engine, their total and each row's count. */
export function IncidentSummaryTile({ tile, slots }: IncidentSummaryTileProps) {
  const t = useWords()
  const shown = partial(t, tile)
  const byProcess = tile.widget.groupBy === "process"
  return (
    <BoardCard title={tileTitle(t, tile)} kind="incidentSummary">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BoardFigure
          text={totalCount(tile.total === undefined ? undefined : { count: tile.total })}
          part="counter-value"
          alarm={tile.total !== undefined && tile.total > 0}
          className="text-title"
        />
        {shown !== undefined && (
          <span className="text-muted-foreground" data-part="counter-partial">
            {shown}
          </span>
        )}
      </p>
      {tile.rows.length === 0 ? (
        <EmptyNote text={t(tile.known === 0 ? "noEngineRead" : "summary.noIncident")} />
      ) : (
        <ul className="flex flex-col" aria-label={t(byProcess ? "perProcess" : "perEngine")}>
          {tile.rows.map((row) => (
            <SummaryRow
              key={`${row.engine}|${row.process?.bpmnProcessId ?? ""}`}
              row={row}
              byProcess={byProcess}
              slots={slots}
            />
          ))}
        </ul>
      )}
    </BoardCard>
  )
}
