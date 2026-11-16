import type {
  IncidentData,
  IncidentGroupData,
  IncidentListTile,
} from "../../../core/protocol/index.js"
import { DataTable, type Column } from "../../components/data-table.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { CountLabels } from "../../format/count-labels.js"
import { TimeLabels } from "../../format/time-labels.js"
import { BoardCard, GROUP_NOTES, MissingNote, type BoardCallbacks } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"

export interface IncidentListCardProps extends Pick<BoardCallbacks, "onOpen" | "onCopy"> {
  readonly tile: IncidentListTile
}

interface IncidentRow {
  readonly engine: string
  readonly incident: IncidentData
}

const ENGINE: Column<IncidentRow> = {
  key: "engine",
  label: "Engine",
  render: (row) => row.engine,
}

const COLUMNS: readonly Column<IncidentRow>[] = [
  {
    key: "process",
    label: "Process",
    render: ({ incident }) => (
      <span title={incident.definition.bpmnProcessId}>
        {BoardLabels.processName(incident.definition)}
      </span>
    ),
  },
  { key: "element", label: "Element", render: ({ incident }) => <code>{incident.elementId}</code> },
  {
    key: "message",
    label: "Message",
    render: ({ incident }) => (
      <span className="inline-block max-w-[48ch] truncate align-bottom" title={incident.message}>
        {incident.message}
      </span>
    ),
  },
  {
    key: "createdAt",
    label: "Since",
    render: ({ incident }) => (
      <span title={TimeLabels.tooltip(incident.createdAt)}>
        {TimeLabels.clock(incident.createdAt)}
      </span>
    ),
  },
]

function GroupNote({ group }: { readonly group: IncidentGroupData }) {
  if (group.incidents === undefined) {
    return <MissingNote engine={group.engine} />
  }
  const shown = CountLabels.exact(group.incidents.length)
  return (
    <li data-part="group-note">
      {group.more === true
        ? `${group.engine}: first ${shown}, more open`
        : `${group.engine}: ${shown} open`}
    </li>
  )
}

export function IncidentListCard({ tile, onOpen, onCopy }: IncidentListCardProps) {
  const rows = tile.groups.flatMap(({ engine, incidents = [] }) =>
    incidents.map((incident) => ({ engine, incident })),
  )
  const columns = tile.groups.length > 1 ? [ENGINE, ...COLUMNS] : COLUMNS
  return (
    <BoardCard title={BoardLabels.title(tile)} kind="incidentList">
      <DataTable
        label="Open incidents"
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.incident.id}`}
        actions={{
          onActivate: (row, toSide) => {
            onOpen({ engine: row.engine, instanceId: row.incident.instanceId }, toSide)
          },
          onCopy: (row) => {
            onCopy(row.incident.message, "Incident message")
          },
        }}
        empty={
          <EmptyHint
            text={
              tile.groups.every((group) => group.incidents === undefined)
                ? "No engine was read."
                : "No open incident on the engines that answered."
            }
          />
        }
        footer={
          <ul className={GROUP_NOTES} aria-label="Per engine">
            {tile.groups.map((group) => (
              <GroupNote key={group.engine} group={group} />
            ))}
          </ul>
        }
      />
    </BoardCard>
  )
}
