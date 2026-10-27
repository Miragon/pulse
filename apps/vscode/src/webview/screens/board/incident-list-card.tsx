import type {
  BoardIncidentRow,
  IncidentGroup,
  IncidentListTile,
} from "../../../core/protocol/index.js"
import { DataTable, type Column } from "../../components/data-table.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { CountLabels } from "../../format/count-labels.js"
import { TimeLabels } from "../../format/time-labels.js"
import { useHost } from "../../host/host-context.js"
import { BoardCard } from "./board-card.js"

const ENGINE: Column<BoardIncidentRow> = {
  key: "engine",
  label: "Engine",
  render: (row) => row.engine,
}

const COLUMNS: readonly Column<BoardIncidentRow>[] = [
  {
    key: "process",
    label: "Process",
    render: (row) => <span title={row.bpmnProcessId}>{row.processName}</span>,
  },
  { key: "element", label: "Element", render: (row) => <code>{row.elementId}</code> },
  {
    key: "message",
    label: "Message",
    render: (row) => (
      <span class="board-incident__message" title={row.message}>
        {row.message}
      </span>
    ),
  },
  {
    key: "createdAt",
    label: "Since",
    render: (row) => (
      <span title={TimeLabels.tooltip(row.createdAt)}>{TimeLabels.clock(row.createdAt)}</span>
    ),
  },
]

function GroupNote({ group }: { readonly group: IncidentGroup }) {
  if (group.unavailable === true) {
    return (
      <li class="board-groups__note board-groups__note--missing">{`${group.engine}: not read`}</li>
    )
  }
  const shown = CountLabels.exact(group.rows.length)
  return (
    <li class="board-groups__note">
      {group.more === true
        ? `${group.engine}: first ${shown}, more open`
        : `${group.engine}: ${shown} open`}
    </li>
  )
}

export function IncidentListCard({ tile }: { readonly tile: IncidentListTile }) {
  const host = useHost()
  const rows = tile.groups.flatMap((group) => group.rows)
  const columns = tile.groups.length > 1 ? [ENGINE, ...COLUMNS] : COLUMNS
  return (
    <BoardCard title={tile.title} kind="incidentList">
      <DataTable
        label={tile.title}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.id}`}
        actions={{
          onActivate: (row, toSide) => {
            host.post({
              type: "openBoardInstance",
              engine: row.engine,
              instanceId: row.instanceId,
              toSide,
            })
          },
          onCopy: (row) => {
            host.post({ type: "copy", text: row.message, label: "Incident message" })
          },
        }}
        empty={
          <EmptyHint
            text={
              tile.groups.every((group) => group.unavailable === true)
                ? "No engine was read."
                : "No open incident on the engines that answered."
            }
          />
        }
        footer={
          <ul class="board-groups" aria-label="Per engine">
            {tile.groups.map((group) => (
              <GroupNote key={group.engine} group={group} />
            ))}
          </ul>
        }
      />
    </BoardCard>
  )
}
