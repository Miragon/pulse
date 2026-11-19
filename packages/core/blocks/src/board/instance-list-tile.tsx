import { CircleXIcon } from "lucide-react"
import {
  Icon,
  SITUATION_TONES,
  StateLabel,
  TONE_ICON,
  cn,
  formatClock,
  formatCount,
  formatInstant,
  shortId,
  type StateLabelState,
} from "@miragon/pulse-ui"
import type {
  BoardColumn,
  InstanceData,
  InstanceGroupData,
  InstanceListData,
  InstanceStateData,
} from "@miragon/pulse-board"
import type { ComponentType } from "react"
import { useWords, type Words } from "../messages/translate.js"
import { BoardCard, EmptyNote, GROUP_NOTES, MissingNote } from "./board-card.js"
import type { BoardIdProps, BoardInstanceTarget, BoardSlots, BoardTableColumn } from "./slots.js"
import { openable } from "./targets.js"
import { countText, listColumns, processName, tileTitle } from "./tile-words.js"

export interface InstanceListTileProps {
  readonly tile: InstanceListData
  readonly slots: Pick<BoardSlots, "Table" | "Id" | "onOpen" | "opens">
}

interface InstanceRow {
  readonly engine: string
  readonly instance: InstanceData
}

const STATES: Readonly<Record<InstanceStateData, StateLabelState>> = {
  running: "running",
  suspended: "suspended",
  completed: "completed",
  terminated: "cancelled",
}

/** The open incident of an instance in a list, a state beside its other columns. */
function IncidentFlag() {
  const t = useWords()
  const tone = SITUATION_TONES.openIncident
  return (
    <span
      className="text-dense inline-flex min-w-0 items-baseline gap-1.5"
      data-part="incident-flag"
      data-tone={tone}
      title={t("incident.flagTitle")}
    >
      <Icon icon={CircleXIcon} className={cn(TONE_ICON[tone], "self-center")} />
      <span className="text-foreground min-w-0 truncate">{t("incident.flag")}</span>
    </span>
  )
}

function Time({ iso }: { readonly iso: string | undefined }) {
  return iso === undefined ? (
    ""
  ) : (
    <span title={formatInstant(iso)}>{formatClock(iso, { seconds: false })}</span>
  )
}

function columnsOf(
  t: Words,
  Id: ComponentType<BoardIdProps>,
): Readonly<Record<BoardColumn, BoardTableColumn<InstanceRow>>> {
  return {
    engine: { key: "engine", label: t("column.engine"), cell: (row) => row.engine },
    process: {
      key: "process",
      label: t("column.process"),
      cell: ({ instance }) => (
        <span title={instance.definition.bpmnProcessId}>{processName(instance.definition)}</span>
      ),
    },
    version: {
      key: "version",
      label: t("column.version"),
      cell: ({ instance }) => t("instances.version", { version: instance.definition.version }),
    },
    businessKey: {
      key: "businessKey",
      label: t("column.businessKey"),
      cell: ({ instance }) =>
        instance.businessKey ?? <Id id={instance.id} label={t("instances.copy")} />,
    },
    state: {
      key: "state",
      label: t("column.state"),
      cell: ({ instance }) => <StateLabel state={STATES[instance.state]} />,
    },
    startedAt: {
      key: "startedAt",
      label: t("column.startedAt"),
      cell: ({ instance }) => <Time iso={instance.startedAt} />,
    },
    endedAt: {
      key: "endedAt",
      label: t("column.endedAt"),
      cell: ({ instance }) => <Time iso={instance.endedAt} />,
    },
    incident: {
      key: "incident",
      label: t("column.incident"),
      cell: ({ instance }) => (instance.hasIncident ? <IncidentFlag /> : ""),
    },
  }
}

function GroupNote({ group }: { readonly group: InstanceGroupData }) {
  const t = useWords()
  if (group.instances === undefined) {
    return <MissingNote engine={group.engine} />
  }
  const total = group.total === undefined ? "?" : countText(group.total)
  return (
    <li data-part="group-note">
      {t("instances.showing", {
        engine: group.engine,
        shown: formatCount(group.instances.length),
        total,
      })}
    </li>
  )
}

/** The instances a filter matches on each engine, in one table over the surface's table. */
export function InstanceListTile({ tile, slots }: InstanceListTileProps) {
  const t = useWords()
  const { Table, Id, onOpen } = slots
  const targetOf = (row: InstanceRow): BoardInstanceTarget => ({
    kind: "instance",
    engine: row.engine,
    instanceId: row.instance.id,
  })
  const rows = tile.groups.flatMap(({ engine, instances = [] }) =>
    instances.map((instance) => ({ engine, instance })),
  )
  const columns = columnsOf(t, Id)
  return (
    <BoardCard title={tileTitle(t, tile)} kind="instanceList">
      <Table<InstanceRow>
        label={t("instances.label")}
        columns={listColumns(tile).map((column) => columns[column])}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.instance.id}`}
        onOpen={(row, how) => {
          const target = openable(slots, targetOf(row))
          if (target !== undefined) onOpen(target, how)
        }}
        opens={(row) => openable(slots, targetOf(row)) !== undefined}
        rowLabel={(row) => t("row.instance", { id: shortId(row.instance.id) })}
        copyOf={(row) => ({ text: row.instance.id, label: t("instances.copy") })}
        empty={<EmptyNote text={t("instances.empty")} />}
        footer={
          <ul className={GROUP_NOTES} aria-label={t("perEngine")}>
            {tile.groups.map((group) => (
              <GroupNote key={group.engine} group={group} />
            ))}
          </ul>
        }
      />
    </BoardCard>
  )
}
