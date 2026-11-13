import type { IncidentSummaryRow, IncidentSummaryTile } from "../../../core/protocol/index.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { BoardCard } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"
import { useOpenTarget } from "./open-target.js"

interface RowProps {
  readonly row: IncidentSummaryRow
  readonly byProcess: boolean
}

function RowText({ row, byProcess }: RowProps) {
  const danger = row.withIncident !== undefined && row.withIncident > 0
  const tone = row.withIncident === undefined ? " muted" : danger ? " danger-count" : ""
  return (
    <>
      <span class="incident-summary__label">{row.label}</span>
      {byProcess && <span class="incident-summary__engine muted">{row.engine}</span>}
      <span class={`incident-summary__count${tone}`}>
        {BoardLabels.entryCount(row.withIncident)}
      </span>
    </>
  )
}

function SummaryRow({ row, byProcess }: RowProps) {
  const open = useOpenTarget()
  return (
    <li class="incident-summary__row">
      {row.withIncident === undefined ? (
        <span class="incident-summary__open incident-summary__open--static">
          <RowText row={row} byProcess={byProcess} />
        </span>
      ) : (
        <button
          type="button"
          class="incident-summary__open"
          title={BoardLabels.openTitle(row.target)}
          onClick={(event) => {
            open(row.target, event.ctrlKey || event.metaKey)
          }}
        >
          <RowText row={row} byProcess={byProcess} />
        </button>
      )}
    </li>
  )
}

export function IncidentSummaryCard({ tile }: { readonly tile: IncidentSummaryTile }) {
  const partial = BoardLabels.partial(tile)
  const byProcess = tile.groupBy === "process"
  return (
    <BoardCard title={tile.title} kind="incidentSummary">
      <p class="counter__total">
        <span
          class={`counter__value${tile.total !== undefined && tile.total > 0 ? " danger-count" : ""}`}
        >
          {BoardLabels.count(tile.total)}
        </span>
        {partial !== undefined && <span class="counter__partial">{partial}</span>}
      </p>
      {tile.rows.length === 0 ? (
        <EmptyHint
          text={tile.known === 0 ? "No engine was read." : "No instance has an open incident."}
        />
      ) : (
        <ul class="incident-summary" aria-label={byProcess ? "Per process" : "Per engine"}>
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
