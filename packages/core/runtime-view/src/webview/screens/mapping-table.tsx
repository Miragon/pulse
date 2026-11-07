import type { MappingRow, MigrationView } from "../../core/protocol/index.js"
import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"
import { useHost } from "../host/host-context.js"

interface MappingCellProps {
  readonly row: MappingRow
  readonly noteId: string | undefined
}

function TargetSelect({ row, noteId }: MappingCellProps) {
  const host = useHost()
  return (
    <select
      class="mapping-table__select"
      aria-label={`Map ${row.sourceLabel} to`}
      aria-describedby={noteId}
      value={row.targetElementId ?? ""}
      onFocus={() => {
        host.post({ type: "focusMapping", sourceElementId: row.sourceElementId })
      }}
      onChange={(event) => {
        const targetElementId = event.currentTarget.value
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
    </select>
  )
}

function NoteCell({ row, noteId }: MappingCellProps) {
  const note = row.problem ?? row.warning
  if (note === undefined) {
    return <span class="muted">–</span>
  }
  return (
    <span
      id={noteId}
      class={row.problem === undefined ? "mapping-table__warning" : "mapping-table__problem"}
    >
      <Icon of={glyphs.TriangleAlert} size={12} />
      {note}
    </span>
  )
}

function SourceCell({ row }: { readonly row: MappingRow }) {
  return (
    <span class="mapping-table__source">
      {row.sourceLabel}
      {row.unmappedTokens === true && <span class="mapping-table__flag">no mapping</span>}
    </span>
  )
}

export function MappingTable({ view }: { readonly view: MigrationView }) {
  const host = useHost()
  return (
    <div class="data-table mapping-table">
      <table aria-label="Mapping">
        <thead>
          <tr>
            <th scope="col">In v{view.source.version}</th>
            <th scope="col">In v{view.target?.version ?? "…"}</th>
            <th scope="col">Waiting</th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => {
            const noteId =
              row.problem === undefined && row.warning === undefined
                ? undefined
                : `mapping-note-${row.sourceElementId}`
            return (
              <tr
                key={row.sourceElementId}
                class={row.sourceElementId === view.focused ? "is-focused" : undefined}
                aria-current={row.sourceElementId === view.focused ? "true" : undefined}
                onClick={() => {
                  host.post({ type: "focusMapping", sourceElementId: row.sourceElementId })
                }}
              >
                <td>
                  <SourceCell row={row} />
                </td>
                <td>
                  {view.target === undefined ? (
                    <span class="muted">–</span>
                  ) : (
                    <TargetSelect row={row} noteId={noteId} />
                  )}
                </td>
                <td>
                  {row.waiting === undefined ? (
                    <span class="muted">–</span>
                  ) : (
                    `${row.waiting} selected ${row.waiting === 1 ? "waits" : "wait"} here`
                  )}
                </td>
                <td>
                  <NoteCell row={row} noteId={noteId} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
