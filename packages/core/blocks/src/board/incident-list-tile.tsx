import { formatClock, formatCount, formatInstant, shortId } from "@miragon/pulse-ui"
import type { IncidentData, IncidentGroupData, IncidentListData } from "@miragon/pulse-board"
import { useWords, type Words } from "../messages/translate.js"
import { BoardCard, EmptyNote, GROUP_NOTES, MissingNote } from "./board-card.js"
import type { BoardSlots, BoardTableColumn } from "./slots.js"
import { processName, tileTitle } from "./tile-words.js"

export interface IncidentListTileProps {
  readonly tile: IncidentListData
  readonly slots: Pick<BoardSlots, "Table" | "onOpen">
}

interface IncidentRow {
  readonly engine: string
  readonly incident: IncidentData
}

function columnsOf(t: Words, engines: number): readonly BoardTableColumn<IncidentRow>[] {
  const columns: readonly BoardTableColumn<IncidentRow>[] = [
    {
      key: "process",
      label: t("column.process"),
      cell: ({ incident }) => (
        <span title={incident.definition.bpmnProcessId}>{processName(incident.definition)}</span>
      ),
    },
    {
      key: "element",
      label: t("column.element"),
      cell: ({ incident }) => <code>{incident.elementId}</code>,
    },
    {
      key: "message",
      label: t("column.message"),
      cell: ({ incident }) => (
        <span className="inline-block max-w-[48ch] truncate align-bottom" title={incident.message}>
          {incident.message}
        </span>
      ),
    },
    {
      key: "createdAt",
      label: t("column.since"),
      cell: ({ incident }) => (
        <span title={formatInstant(incident.createdAt)}>
          {formatClock(incident.createdAt, { seconds: false })}
        </span>
      ),
    },
  ]
  return engines > 1
    ? [{ key: "engine", label: t("column.engine"), cell: (row) => row.engine }, ...columns]
    : columns
}

function GroupNote({ group }: { readonly group: IncidentGroupData }) {
  const t = useWords()
  if (group.incidents === undefined) {
    return <MissingNote engine={group.engine} />
  }
  const shown = formatCount(group.incidents.length)
  return (
    <li data-part="group-note">
      {t(group.more === true ? "incidents.firstMore" : "incidents.open", {
        engine: group.engine,
        shown,
      })}
    </li>
  )
}

/** The open incidents of each engine, newest first, in one table over the surface's table. */
export function IncidentListTile({ tile, slots }: IncidentListTileProps) {
  const t = useWords()
  const { Table, onOpen } = slots
  const rows = tile.groups.flatMap(({ engine, incidents = [] }) =>
    incidents.map((incident) => ({ engine, incident })),
  )
  const unread = tile.groups.every((group) => group.incidents === undefined)
  return (
    <BoardCard title={tileTitle(t, tile)} kind="incidentList">
      <Table<IncidentRow>
        label={t("title.openIncidents")}
        columns={columnsOf(t, tile.groups.length)}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.incident.id}`}
        onOpen={({ engine, incident }, how) => {
          onOpen(
            { kind: "instance", engine, instanceId: incident.instanceId, incidentId: incident.id },
            how,
          )
        }}
        openLabel={({ incident }) => t("open.instance", { id: shortId(incident.instanceId) })}
        copyOf={({ incident }) => ({ text: incident.message, label: t("incidents.copy") })}
        empty={<EmptyNote text={t(unread ? "noEngineRead" : "incidents.empty")} />}
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
