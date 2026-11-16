import type {
  BoardColumn,
  InstanceData,
  InstanceGroupData,
  InstanceListTile,
} from "../../../core/protocol/index.js"
import { DataTable, type Column } from "../../components/data-table.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { IncidentFlag, StateLabel } from "../../components/state-label.js"
import { CountLabels } from "../../format/count-labels.js"
import { TimeLabels } from "../../format/time-labels.js"
import { BoardCard, GROUP_NOTES, MissingNote, type BoardCallbacks } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"

export interface InstanceListCardProps extends Pick<BoardCallbacks, "onOpen" | "onCopy"> {
  readonly tile: InstanceListTile
}

interface InstanceRow {
  readonly engine: string
  readonly instance: InstanceData
}

const COLUMNS: Readonly<Record<BoardColumn, Column<InstanceRow>>> = {
  engine: { key: "engine", label: "Engine", render: (row) => row.engine },
  process: {
    key: "process",
    label: "Process",
    render: ({ instance }) => (
      <span title={instance.definition.bpmnProcessId}>
        {BoardLabels.processName(instance.definition)}
      </span>
    ),
  },
  version: {
    key: "version",
    label: "Version",
    render: ({ instance }) => `v${instance.definition.version}`,
  },
  businessKey: {
    key: "businessKey",
    label: "Business key",
    render: ({ instance }) =>
      instance.businessKey ?? (
        <code className="text-muted-foreground">{BoardLabels.shortId(instance.id)}</code>
      ),
  },
  state: {
    key: "state",
    label: "State",
    render: ({ instance }) => <StateLabel state={BoardLabels.state(instance.state)} />,
  },
  startedAt: {
    key: "startedAt",
    label: "Started",
    render: ({ instance }) =>
      instance.startedAt === undefined ? (
        ""
      ) : (
        <span title={TimeLabels.tooltip(instance.startedAt)}>
          {TimeLabels.clock(instance.startedAt)}
        </span>
      ),
  },
  endedAt: {
    key: "endedAt",
    label: "Ended",
    render: ({ instance }) =>
      instance.endedAt === undefined ? (
        ""
      ) : (
        <span title={TimeLabels.tooltip(instance.endedAt)}>
          {TimeLabels.clock(instance.endedAt)}
        </span>
      ),
  },
  incident: {
    key: "incident",
    label: "Incident",
    render: ({ instance }) => (instance.hasIncident ? <IncidentFlag /> : ""),
  },
}

function GroupNote({ group }: { readonly group: InstanceGroupData }) {
  if (group.instances === undefined) {
    return <MissingNote engine={group.engine} />
  }
  const total =
    group.total === undefined
      ? "?"
      : CountLabels.exact(group.total.count, group.total.atLeast === true)
  return (
    <li data-part="group-note">{`${group.engine}: showing ${CountLabels.exact(group.instances.length)} of ${total}`}</li>
  )
}

export function InstanceListCard({ tile, onOpen, onCopy }: InstanceListCardProps) {
  const rows = tile.groups.flatMap(({ engine, instances = [] }) =>
    instances.map((instance) => ({ engine, instance })),
  )
  return (
    <BoardCard title={BoardLabels.title(tile)} kind="instanceList">
      <DataTable
        label="Instances"
        columns={BoardLabels.columns(tile).map((column) => COLUMNS[column])}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.instance.id}`}
        actions={{
          onActivate: (row, toSide) => {
            onOpen({ engine: row.engine, instanceId: row.instance.id }, toSide)
          },
          onCopy: (row) => {
            onCopy(row.instance.id, "Instance ID")
          },
        }}
        empty={<EmptyHint text="No instance matches on the engines that answered." />}
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
