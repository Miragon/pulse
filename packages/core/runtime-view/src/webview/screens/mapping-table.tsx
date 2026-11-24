import { DataTable, Td, cn, type DataTableColumn } from "@miragon/pulse-ui"
import type { MappingRow, MigrationView } from "../../core/protocol/index.js"
import { NoValue } from "../components/no-value.js"
import { CountLabels } from "../format/count-labels.js"
import { useHost } from "../host/host-context.js"
import { NoteCell, SourceCell, TargetSelect } from "./mapping-cells.js"

class MappingColumns {
  static of(view: MigrationView): DataTableColumn[] {
    return [
      { key: "source", label: `In v${view.source.version}`, fit: true },
      { key: "target", label: `In v${view.target?.version ?? "…"}`, fit: true },
      { key: "waiting", label: "Waiting", fit: true },
      { key: "check", label: "Check" },
    ]
  }
}

function WaitingText({ waiting }: { readonly waiting: number | undefined }) {
  return waiting === undefined ? (
    <NoValue />
  ) : (
    `${CountLabels.exact(waiting)} selected ${waiting === 1 ? "waits" : "wait"} here`
  )
}

function MappingLine({ row, view }: { readonly row: MappingRow; readonly view: MigrationView }) {
  const host = useHost()
  const focused = row.sourceElementId === view.focused
  const noteId =
    row.problem === undefined && row.warning === undefined
      ? undefined
      : `mapping-note-${row.sourceElementId}`
  return (
    <tr
      className={cn(
        "cursor-pointer",
        focused && "bg-info-surface outline-interaction outline-2 -outline-offset-2 outline-solid",
      )}
      aria-current={focused ? "true" : undefined}
      onClick={() => {
        host.post({ type: "focusMapping", sourceElementId: row.sourceElementId })
      }}
    >
      <Td>
        <SourceCell label={row.sourceLabel} unmappedTokens={row.unmappedTokens === true} />
      </Td>
      <Td>
        {view.target === undefined ? (
          <NoValue />
        ) : (
          <TargetSelect
            sourceElementId={row.sourceElementId}
            sourceLabel={row.sourceLabel}
            candidates={row.candidates}
            targetElementId={row.targetElementId}
            noteId={noteId}
          />
        )}
      </Td>
      <Td>
        <WaitingText waiting={row.waiting} />
      </Td>
      <Td>
        <NoteCell
          note={row.problem ?? row.warning}
          tone={row.problem === undefined ? "warning" : "danger"}
          noteId={noteId}
        />
      </Td>
    </tr>
  )
}

export function MappingTable({ view }: { readonly view: MigrationView }) {
  return (
    <DataTable label="Mapping" columns={MappingColumns.of(view)} className="min-h-0 flex-1">
      {view.rows.map((row) => (
        <MappingLine key={row.sourceElementId} row={row} view={view} />
      ))}
    </DataTable>
  )
}
