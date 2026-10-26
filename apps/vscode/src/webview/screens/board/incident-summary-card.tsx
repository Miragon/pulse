import type { IncidentSummaryRow, IncidentSummaryTile } from "../../../core/protocol/index.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { BoardCard } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"
import { useOpenTarget } from "./open-target.js"

function SummaryRow({
  row,
  byProcess,
}: {
  readonly row: IncidentSummaryRow
  readonly byProcess: boolean
}) {
  const open = useOpenTarget()
  const danger = row.withIncident !== undefined && row.withIncident > 0
  return (
    <li class="incident-summary__row">
      <button
        type="button"
        class="incident-summary__open"
        disabled={row.withIncident === undefined}
        title={
          row.withIncident === undefined
            ? `${row.engine} could not be read`
            : `Show them on ${row.engine}`
        }
        onClick={(event) => {
          open(row.target, event.ctrlKey || event.metaKey)
        }}
      >
        <span class="incident-summary__label">{row.label}</span>
        {byProcess && <span class="incident-summary__engine muted">{row.engine}</span>}
        <span class={`incident-summary__count${danger ? " danger-count" : ""}`}>
          {BoardLabels.count(row.withIncident)}
        </span>
      </button>
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
          text={tile.known === 0 ? "No engine answered." : "No instance has an open incident."}
        />
      ) : (
        <ul class="incident-summary" aria-label={byProcess ? "Per process" : "Per engine"}>
          {tile.rows.map((row) => (
            <SummaryRow key={`${row.engine}|${row.label}`} row={row} byProcess={byProcess} />
          ))}
        </ul>
      )}
    </BoardCard>
  )
}
