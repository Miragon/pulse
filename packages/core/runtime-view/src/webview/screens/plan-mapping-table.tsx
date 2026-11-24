import { DataTable, FOCUS_RING, Td, cn, type DataTableColumn } from "@miragon/pulse-ui"
import type { MigrationPlanView, PlanMappingRow } from "../../core/protocol/index.js"
import { NoValue } from "../components/no-value.js"
import { CountLabels } from "../format/count-labels.js"
import { useHost } from "../host/host-context.js"
import { NoteCell, SourceCell, TargetSelect } from "./mapping-cells.js"

const SOURCE_BUTTON = cn(
  "min-h-control-xs h-control-xs min-w-control-xs inline-flex cursor-pointer items-center rounded-sm text-left whitespace-nowrap hover:underline in-[td]:focus-visible:ring-offset-0",
  FOCUS_RING,
)

const FOCUSED_ROW = "bg-info-surface outline-interaction outline-2 -outline-offset-2 outline-solid"

class PlanColumns {
  static of(view: MigrationPlanView): DataTableColumn[] {
    return [
      { key: "source", label: `In v${view.source.version}`, fit: true },
      { key: "target", label: `In v${view.target.version}`, fit: true },
      { key: "tokens", label: "Tokens", fit: true },
      { key: "check", label: "Check" },
    ]
  }
}

interface PlanCellProps {
  readonly row: PlanMappingRow
  readonly noteId: string | undefined
}

function SourceButton({ row, noteId }: PlanCellProps) {
  const host = useHost()
  return (
    <button
      type="button"
      className={SOURCE_BUTTON}
      aria-describedby={noteId}
      onClick={() => {
        host.post({ type: "focusMapping", sourceElementId: row.sourceElementId })
      }}
    >
      {row.sourceLabel}
    </button>
  )
}

function TokensText({ tokens }: { readonly tokens: number | undefined }) {
  return tokens === undefined ? <NoValue /> : CountLabels.exact(tokens)
}

function PlanLine({ row, focused }: { readonly row: PlanMappingRow; readonly focused: boolean }) {
  const danger = row.refused ?? row.problem
  const note = danger ?? row.warning
  const noteId = note === undefined ? undefined : `plan-note-${row.sourceElementId}`
  return (
    <tr className={cn(focused && FOCUSED_ROW)} aria-current={focused ? "true" : undefined}>
      <Td>
        <SourceCell
          label={<SourceButton row={row} noteId={noteId} />}
          unmappedTokens={row.unmappedTokens === true}
        />
      </Td>
      <Td>
        <TargetSelect
          sourceElementId={row.sourceElementId}
          sourceLabel={row.sourceLabel}
          candidates={row.candidates}
          targetElementId={row.targetElementId}
          targetLabel={row.targetLabel}
          noteId={noteId}
        />
      </Td>
      <Td className="tabular-nums">
        <TokensText tokens={row.tokens} />
      </Td>
      <Td>
        <NoteCell note={note} tone={danger === undefined ? "warning" : "danger"} noteId={noteId} />
      </Td>
    </tr>
  )
}

export function PlanMappingTable({ view }: { readonly view: MigrationPlanView }) {
  return (
    <DataTable label="Mapping" columns={PlanColumns.of(view)} className="min-h-0 flex-1">
      {view.rows.map((row) => (
        <PlanLine
          key={row.sourceElementId}
          row={row}
          focused={row.sourceElementId === view.focused}
        />
      ))}
    </DataTable>
  )
}
