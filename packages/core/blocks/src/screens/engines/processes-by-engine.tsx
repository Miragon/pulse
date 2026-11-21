import { CountFigure, formatCount, Icon } from "@miragon/pulse-ui"
import type { FleetProcessData } from "@miragon/pulse-screens"
import { Info } from "lucide-react"
import type { ComponentType } from "react"
import { useEnginesWords } from "../../messages/engines-words.js"
import { IncidentCount } from "../incident-count.js"
import type { ScreenIdProps, ScreenPlainTableSlot, ScreenTableColumn } from "../slots.js"

export interface ProcessesByEngineProps {
  /** Each process over the engines it runs on (`FleetSums`' processes). */
  readonly processes: readonly FleetProcessData[]
  /** The engines read, a column each in this order. */
  readonly engines: readonly string[]
  /** The engines not read, which have no column: the line under the table names them. */
  readonly unread?: readonly string[]
  readonly slots: {
    readonly PlainTable: ScreenPlainTableSlot
    readonly Id: ComponentType<ScreenIdProps>
  }
}

/** A process's running instances on an engine, or a quiet empty cell where it is not deployed. */
function RunningOn({
  process,
  engine,
}: {
  readonly process: FleetProcessData
  readonly engine: string
}) {
  const t = useEnginesWords()
  const cell = process.engines.find((on) => on.engine === engine)
  if (cell === undefined)
    return <span className="sr-only">{t("matrix.notDeployed", { engine })}</span>
  return <CountFigure>{formatCount(cell.running)}</CountFigure>
}

/**
 * What runs where: a row per process over the surface's plain table, its running instances on each
 * engine read (all versions) and its instances with incident over all of them; an empty cell where
 * it is not deployed. Counts only, never a rate: engines run different processes, so a rate summed
 * across them would measure their mix, which the note above the table says. An engine not read has
 * no column, the line under the table names it.
 */
export function ProcessesByEngine({
  processes,
  engines,
  unread = [],
  slots,
}: ProcessesByEngineProps) {
  const t = useEnginesWords()
  const { PlainTable, Id } = slots
  const columns: ScreenTableColumn<FleetProcessData>[] = [
    {
      key: "process",
      label: t("matrix.column.process"),
      cell: ({ bpmnProcessId, name }) => (
        <Id
          id={bpmnProcessId}
          {...(name === undefined ? {} : { name })}
          label={t("matrix.processId")}
        />
      ),
    },
    ...engines.map((engine): ScreenTableColumn<FleetProcessData> => ({
      key: `engine:${engine}`,
      label: engine,
      cell: (process) => <RunningOn process={process} engine={engine} />,
    })),
    {
      key: "withIncident",
      label: t("matrix.column.withIncident"),
      cell: ({ withIncident }) => (
        <IncidentCount count={withIncident} part="incident-count" alarm={t("engines.alarm")} />
      ),
    },
  ]
  return (
    <div className="flex min-w-0 flex-col gap-2" data-part="processes-by-engine">
      <p className="text-muted-foreground flex items-start gap-2" data-part="counts-note">
        <Icon icon={Info} />
        <span>{t("matrix.note")}</span>
      </p>
      <PlainTable<FleetProcessData>
        name="processes-by-engine"
        label={t("matrix.label")}
        columns={columns}
        rows={processes}
        rowKey={(process) => process.bpmnProcessId}
        empty={t("matrix.none")}
      />
      {unread.length > 0 && (
        <p className="text-muted-foreground" data-part="unread">
          {t("matrix.unread", { engines: unread.join(", ") })}
        </p>
      )}
    </div>
  )
}
