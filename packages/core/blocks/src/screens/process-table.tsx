import { CountFigure, formatCount } from "@miragon/pulse-ui"
import type {
  EngineTotalsData,
  FilteredProcessesData,
  ProcessFilterData,
  ProcessRowData,
  ScreenTarget,
} from "@miragon/pulse-screens"
import type { ComponentType } from "react"
import { useScreenWords, type ScreenWords } from "../messages/screen-words.js"
import type { ScreenIdProps, ScreenSlots, ScreenTableColumn } from "./slots.js"

export interface ProcessTableProps {
  /** The engine the processes are deployed on, as the surface names it. */
  readonly engine: string
  /**
   * The rows the filter leaves and the counts of both scopes: `useProcessList` over the engine
   * screen's processes, or what a surface's own filter gave (the editors' core runs the same rule).
   */
  readonly listed: FilteredProcessesData
  /** The filter the rows are listed by. */
  readonly filter: ProcessFilterData
  /**
   * The engine screen's totals over every process: an engine they count no process on lists none,
   * whatever the search, and an empty table says so instead of blaming the filter.
   */
  readonly totals: EngineTotalsData
  readonly slots: Pick<ScreenSlots, "Table" | "Id" | "onOpen" | "linkOf">
}

/**
 * A count of a process that alarms above 0 (its instances with incident, its open root incidents):
 * a neutral figure, its alarm icon and words above 0, a count the engine stopped at as a lower
 * bound (`≥ 10,000`).
 */
function IncidentCount({
  count,
  atLeast = false,
  part,
}: {
  readonly count: number
  readonly atLeast?: boolean | undefined
  readonly part: "incident-count" | "root-incident-count"
}) {
  const t = useScreenWords()
  const text = formatCount(atLeast ? { atLeast: count } : count)
  return (
    <span data-part={part} data-tone={count > 0 ? "danger" : undefined}>
      {count > 0 ? (
        <CountFigure situation="openIncident" label={t("process.alarm")}>
          {text}
        </CountFigure>
      ) : (
        <CountFigure>{text}</CountFigure>
      )}
    </span>
  )
}

function columnsOf(
  t: ScreenWords,
  Id: ComponentType<ScreenIdProps>,
): ScreenTableColumn<ProcessRowData>[] {
  return [
    {
      key: "process",
      label: t("column.process"),
      cell: ({ bpmnProcessId, name }) => (
        <Id id={bpmnProcessId} {...(name === undefined ? {} : { name })} label={t("process.id")} />
      ),
    },
    {
      key: "version",
      label: t("column.latestVersion"),
      cell: (row) => t("process.version", { version: row.latestVersion }),
      hideBelow: "40rem",
    },
    {
      key: "running",
      label: t("column.running"),
      cell: (row) => <CountFigure>{formatCount(row.running)}</CountFigure>,
      hideBelow: "40rem",
    },
    {
      key: "withIncident",
      label: t("column.withIncident"),
      cell: (row) => <IncidentCount count={row.withIncident} part="incident-count" />,
    },
    {
      key: "incidents",
      label: t("column.incidents"),
      cell: (row) => (
        <IncidentCount
          count={row.incidents}
          atLeast={row.incidentsAtLeast}
          part="root-incident-count"
        />
      ),
    },
  ]
}

/**
 * An engine's processes, one row each over the surface's table (the engine screen's process rows):
 * the process by its name and BPMN process ID, its latest version, its running instances, its
 * instances with incident and its open root incidents, each count over every version (a caller
 * waiting for an incident in an instance it called is an instance with incident, and the incident
 * counts at the process it was raised in). A row opens its process and copies its BPMN process ID;
 * the latest version and the running instances drop in a narrow region.
 */
export function ProcessTable({ engine, listed, filter, totals, slots }: ProcessTableProps) {
  const t = useScreenWords()
  const { Table, Id, onOpen, linkOf } = slots
  const targetOf = (row: ProcessRowData): ScreenTarget => ({
    kind: "process",
    engine,
    bpmnProcessId: row.bpmnProcessId,
  })
  // How many processes the engine lists: without a search the list's count over every scope, the
  // rows a surface hands in; a search narrows that count, so then the screen's totals tell.
  const deployed = (filter.search ?? "") === "" ? listed.counts.all : totals.processes
  return (
    <Table<ProcessRowData>
      name="processes"
      label={t("processes.label")}
      columns={columnsOf(t, Id)}
      rows={listed.processes}
      rowKey={(row) => row.bpmnProcessId}
      onOpen={(row, how) => {
        onOpen(targetOf(row), how)
      }}
      {...(linkOf === undefined ? {} : { linkOf: (row: ProcessRowData) => linkOf(targetOf(row)) })}
      rowLabel={(row) => t("process.row", { name: row.name ?? row.bpmnProcessId })}
      copyOf={(row) => ({ text: row.bpmnProcessId, label: t("process.id") })}
      empty={deployed === 0 ? t("processes.none", { engine }) : t("processes.noMatch")}
    />
  )
}
