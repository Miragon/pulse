import {
  DataTable,
  Icon,
  NativeSelect,
  TONE_ICON,
  Td,
  cn,
  type DataTableColumn,
} from "@miragon/pulse-ui"
import { CircleXIcon, TriangleAlertIcon } from "lucide-react"
import type { MappingRow, MigrationView } from "../../core/protocol/index.js"
import { NoValue } from "../components/no-value.js"
import { usePendingValue } from "../components/pending-value.js"
import { CountLabels } from "../format/count-labels.js"
import { useHost } from "../host/host-context.js"

interface MappingCellProps {
  readonly row: MappingRow
  readonly noteId: string | undefined
}

function TargetSelect({ row, noteId }: MappingCellProps) {
  const host = useHost()
  const [target, pick] = usePendingValue(row.targetElementId ?? "")
  return (
    <NativeSelect
      className="min-h-control-xs h-control-xs max-w-[280px] px-2"
      aria-label={`Map ${row.sourceLabel} to`}
      aria-describedby={noteId}
      value={target}
      onFocus={() => {
        host.post({ type: "focusMapping", sourceElementId: row.sourceElementId })
      }}
      onChange={(event) => {
        const targetElementId = event.currentTarget.value
        pick(targetElementId)
        host.post(
          targetElementId === ""
            ? { type: "unmapElement", sourceElementId: row.sourceElementId }
            : { type: "mapElement", sourceElementId: row.sourceElementId, targetElementId },
        )
      }}
    >
      <option value="">Not mapped</option>
      {row.candidates.map((candidate) => (
        <option key={candidate.elementId} value={candidate.elementId}>
          {candidate.label}
        </option>
      ))}
    </NativeSelect>
  )
}

function NoteCell({ row, noteId }: MappingCellProps) {
  const note = row.problem ?? row.warning
  if (note === undefined) {
    return <NoValue />
  }
  const problem = row.problem !== undefined
  return (
    <span
      id={noteId}
      className="inline-flex items-center gap-1"
      data-part="mapping-note"
      data-tone={problem ? "danger" : "warning"}
    >
      <Icon
        icon={problem ? CircleXIcon : TriangleAlertIcon}
        dense
        className={problem ? TONE_ICON.danger : TONE_ICON.warning}
      />
      {note}
    </span>
  )
}

function SourceCell({ row }: { readonly row: MappingRow }) {
  return (
    <span className="inline-flex items-center gap-2">
      {row.sourceLabel}
      {row.unmappedTokens === true && (
        <span className="inline-flex items-center gap-1">
          <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
          no mapping
        </span>
      )}
    </span>
  )
}

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
        <SourceCell row={row} />
      </Td>
      <Td>
        {view.target === undefined ? <NoValue /> : <TargetSelect row={row} noteId={noteId} />}
      </Td>
      <Td>
        <WaitingText waiting={row.waiting} />
      </Td>
      <Td>
        <NoteCell row={row} noteId={noteId} />
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
