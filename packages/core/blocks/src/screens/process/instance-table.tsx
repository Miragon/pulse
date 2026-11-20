import { CircleXIcon } from "lucide-react"
import type { ComponentType, ReactNode } from "react"
import {
  Icon,
  SITUATION_TONES,
  StateLabel,
  TONE_ICON,
  cn,
  shortId,
  type StateLabelState,
} from "@miragon/pulse-ui"
import type {
  InstanceListFilterData,
  InstanceRowData,
  InstanceStateCode,
  ScreenTarget,
} from "@miragon/pulse-screens"
import { useProcessWords, type ProcessWords } from "../../messages/process-words.js"
import { InstanceTime, NoValue } from "../instance/instance-time.js"
import type { ScreenIdProps, ScreenSlots, ScreenTableColumn } from "../slots.js"
import { InstanceFilters } from "./instance-filters.js"

const STATES: Readonly<Record<InstanceStateCode, StateLabelState>> = {
  running: "running",
  suspended: "suspended",
  completed: "completed",
  terminated: "cancelled",
}

/**
 * The surface's selection of rows, a write slot only a surface that writes fills (the editors' bulk
 * actions): the column of its boxes, first in the row, and what Space on a row toggles.
 */
export interface InstanceSelectSlot<Row> {
  readonly column: ScreenTableColumn<Row>
  readonly onToggle: (row: Row) => void
}

export interface InstanceTableProps<Row extends InstanceRowData> {
  /** The engine the instances run on, as the surface names it. */
  readonly engine: string
  /** The rows shown: the pages read so far (`InstanceRows.appended`). */
  readonly rows: readonly Row[]
  /** The filter the rows are listed by: an empty table says why it is empty. */
  readonly filter: InstanceListFilterData
  /** The filter its empty state asks for: without the variable conditions that left no row. */
  readonly onFilter: (filter: InstanceListFilterData) => void
  /** What the table shows under its rows: the blocks' `LoadMore` while more follow. */
  readonly footer?: ReactNode
  /** The surface's selection, a write slot; none on a surface that writes nothing. */
  readonly select?: InstanceSelectSlot<Row> | undefined
  readonly slots: Pick<ScreenSlots, "Table" | "Id" | "onOpen" | "linkOf">
}

/** An open incident beside an instance's state: its icon, one word, the alarm in its title. */
function IncidentFlag() {
  const t = useProcessWords()
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

function columnsOf<Row extends InstanceRowData>(
  t: ProcessWords,
  Id: ComponentType<ScreenIdProps>,
): ScreenTableColumn<Row>[] {
  return [
    {
      key: "id",
      label: t("column.id"),
      cell: (row) => <Id id={row.id} label={t("instance.id")} />,
    },
    {
      key: "businessKey",
      label: t("column.businessKey"),
      cell: (row) => row.businessKey ?? <NoValue />,
    },
    {
      key: "state",
      label: t("column.state"),
      cell: (row) => (
        <span className="inline-flex items-center gap-3">
          <StateLabel state={STATES[row.state]} />
          {row.hasIncident && <IncidentFlag />}
        </span>
      ),
    },
    {
      key: "started",
      label: t("column.started"),
      cell: (row) => <InstanceTime iso={row.startedAt} />,
    },
  ]
}

/** What an empty table says: no match, or none under the variable conditions with a way out. */
function emptyOf(t: ProcessWords, filter: InstanceListFilterData) {
  return filter.variables === undefined
    ? t("instances.noMatch")
    : t(`instances.noVariableMatch.${filter.scope}`)
}

/**
 * A process's instances, one row each over the surface's table (the instance list's rows): its id,
 * its business key, its state with an open incident beside it, when it started. A row opens its
 * instance and copies its id; under the rows the surface's footer (the next page), before them the
 * surface's selection where it writes.
 */
export function InstanceTable<Row extends InstanceRowData>(props: InstanceTableProps<Row>) {
  const { engine, rows, filter, onFilter, footer, select, slots } = props
  const t = useProcessWords()
  const { Table, Id, onOpen, linkOf } = slots
  const targetOf = (row: Row): ScreenTarget => ({ kind: "instance", engine, instanceId: row.id })
  const columns = columnsOf<Row>(t, Id)
  return (
    <Table<Row>
      name="instances"
      label={t("instances.label")}
      columns={select === undefined ? columns : [select.column, ...columns]}
      rows={rows}
      rowKey={(row) => row.id}
      onOpen={(row, how) => {
        onOpen(targetOf(row), how)
      }}
      {...(linkOf === undefined ? {} : { linkOf: (row: Row) => linkOf(targetOf(row)) })}
      rowLabel={(row) => t("instance.row", { name: row.businessKey ?? shortId(row.id) })}
      copyOf={(row) => ({ text: row.id, label: t("instance.id") })}
      empty={emptyOf(t, filter)}
      {...(filter.variables === undefined
        ? {}
        : {
            emptyAction: {
              label: t("instances.clearVariables"),
              onClick: () => {
                onFilter(InstanceFilters.withoutVariables(filter))
              },
            },
          })}
      {...(footer === undefined ? {} : { footer })}
      {...(select === undefined ? {} : { onToggle: select.onToggle })}
    />
  )
}
