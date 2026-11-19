import { formatClock, formatCount, formatInstant, shortId } from "@miragon/pulse-ui"
import type { IncidentData, IncidentGroupData, IncidentListData } from "@miragon/pulse-board"
import { useWords, type Words } from "../messages/translate.js"
import { BoardCard, EmptyNote, GROUP_NOTES, MissingNote } from "./board-card.js"
import type { BoardInstanceTarget, BoardSlots, BoardTableColumn } from "./slots.js"
import { openable } from "./targets.js"
import { processName, tileTitle, titleNamesProcess } from "./tile-words.js"

export interface IncidentListTileProps {
  readonly tile: IncidentListData
  readonly slots: Pick<BoardSlots, "Table" | "onOpen" | "opens">
}

interface IncidentRow {
  readonly engine: string
  readonly incident: IncidentData
}

/**
 * The tile's columns: the engine first over several engines; the process unless the tile's title
 * names it (the untitled tile of one process, `titleNamesProcess`), where the message takes the
 * room. A title the file gives keeps the column, so the process stays in sight.
 */
function columnsOf(
  t: Words,
  engines: number,
  processInTitle: boolean,
): readonly BoardTableColumn<IncidentRow>[] {
  const process: BoardTableColumn<IncidentRow> = {
    key: "process",
    label: t("column.process"),
    cell: ({ incident }) => (
      <span title={incident.definition.bpmnProcessId}>{processName(incident.definition)}</span>
    ),
  }
  const columns: readonly BoardTableColumn<IncidentRow>[] = [
    ...(processInTitle ? [] : [process]),
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
  const targetOf = ({ engine, incident }: IncidentRow): BoardInstanceTarget => ({
    kind: "instance",
    engine,
    instanceId: incident.instanceId,
    incidentId: incident.id,
  })
  const rows = tile.groups.flatMap(({ engine, incidents = [] }) =>
    incidents.map((incident) => ({ engine, incident })),
  )
  const unread = tile.groups.every((group) => group.incidents === undefined)
  return (
    <BoardCard title={tileTitle(t, tile)} kind="incidentList">
      <Table<IncidentRow>
        label={t("incidents.label")}
        columns={columnsOf(t, tile.groups.length, titleNamesProcess(tile))}
        rows={rows}
        rowKey={(row) => `${row.engine}|${row.incident.id}`}
        onOpen={(row, how) => {
          const target = openable(slots, targetOf(row))
          if (target !== undefined) onOpen(target, how)
        }}
        opens={(row) => openable(slots, targetOf(row)) !== undefined}
        // Named after what it opens, the instance, at the element its incident is at.
        rowLabel={({ incident }) =>
          t("row.instanceAt", { id: shortId(incident.instanceId), element: incident.elementId })
        }
        copyOf={({ incident }) => ({ text: incident.message, label: t("incidents.copy") })}
        copyHint={t("incidents.copyHint")}
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
