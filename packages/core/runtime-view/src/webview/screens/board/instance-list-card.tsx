import type {
  BoardColumn,
  BoardInstanceRow,
  InstanceGroup,
  InstanceListTile,
} from "../../../core/protocol/index.js"
import { DataTable, type Column } from "../../components/data-table.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { IncidentFlag, StateLabel } from "../../components/state-label.js"
import { CountLabels } from "../../format/count-labels.js"
import { TimeLabels } from "../../format/time-labels.js"
import { useHost } from "../../host/host-context.js"
import { BoardCard } from "./board-card.js"

const COLUMNS: Readonly<Record<BoardColumn, Column<BoardInstanceRow>>> = {
  engine: { key: "engine", label: "Engine", render: (row) => row.engine },
  process: {
    key: "process",
    label: "Process",
    render: (row) => <span title={row.bpmnProcessId}>{row.processName}</span>,
  },
  version: { key: "version", label: "Version", render: (row) => `v${row.version}` },
  businessKey: {
    key: "businessKey",
    label: "Business key",
    render: (row) => row.businessKey ?? <code class="muted">{row.shortId}</code>,
  },
  state: { key: "state", label: "State", render: (row) => <StateLabel state={row.state} /> },
  startedAt: {
    key: "startedAt",
    label: "Started",
    render: (row) =>
      row.startedAt === undefined ? (
        ""
      ) : (
        <span title={TimeLabels.tooltip(row.startedAt)}>{TimeLabels.clock(row.startedAt)}</span>
      ),
  },
  endedAt: {
    key: "endedAt",
    label: "Ended",
    render: (row) =>
      row.endedAt === undefined ? (
        ""
      ) : (
        <span title={TimeLabels.tooltip(row.endedAt)}>{TimeLabels.clock(row.endedAt)}</span>
      ),
  },
  incident: {
    key: "incident",
    label: "Incident",
    render: (row) => (row.hasIncident ? <IncidentFlag /> : ""),
  },
}

function GroupNote({ group }: { readonly group: InstanceGroup }) {
  if (group.unavailable === true) {
    return (
      <li class="board-groups__note board-groups__note--missing">{`${group.engine}: not read`}</li>
    )
  }
  const total = group.total === undefined ? "?" : CountLabels.exact(group.total)
  return (
    <li class="board-groups__note">{`${group.engine}: showing ${CountLabels.exact(group.rows.length)} of ${total}`}</li>
  )
}

export function InstanceListCard({ tile }: { readonly tile: InstanceListTile }) {
  const host = useHost()
  const rows = tile.groups.flatMap((group) => group.rows)
  return (
    <BoardCard title={tile.title} kind="instanceList">
      <DataTable
        label={tile.title}
        columns={tile.columns.map((column) => COLUMNS[column])}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.id}`}
        actions={{
          onActivate: (row, toSide) => {
            host.post({ type: "openBoardInstance", engine: row.engine, instanceId: row.id, toSide })
          },
          onCopy: (row) => {
            host.post({ type: "copy", text: row.id, label: "Instance ID" })
          },
        }}
        empty={<EmptyHint text="No instance matches on the engines that answered." />}
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
