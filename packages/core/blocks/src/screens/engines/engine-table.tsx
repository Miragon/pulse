import { CountFigure, formatCount, Icon, TONE_ICON } from "@miragon/pulse-ui"
import type { FleetEngineData, ScreenTarget } from "@miragon/pulse-screens"
import { Ban, CircleAlert, Minus, Server } from "lucide-react"
import type { ReactNode } from "react"
import { useEnginesWords } from "../../messages/engines-words.js"
import { IncidentCount } from "../incident-count.js"
import type { OutsideAnyProcessData } from "../../verdict/outside-any-process.js"
import type { ScreenSlots, ScreenTableColumn } from "../slots.js"
import { type EngineVerdict, EngineVerdictCell } from "./engine-verdict.js"

/**
 * An engine's row across engines: its engine screen summed (`FleetSums`' engine, once read) and,
 * on a surface that shows one, its live state (`verdict`), or where its read stands without
 * figures: still reading, failed, or refused by the server, whose words the surface says beside
 * the table, or not read for a reason that is not the engine's (a page's ended session, which its
 * frame says once: `unread`, without a tone).
 */
export type EngineRowData =
  | {
      readonly engine: string
      readonly state: "read"
      readonly sums: FleetEngineData
      /** Its live state, where the surface shows one (`withVerdict`); none without it. */
      readonly verdict?: EngineVerdict
      /** The root incidents outside any process its verdict judged, where the surface shows it. */
      readonly outside?: OutsideAnyProcessData
    }
  | { readonly engine: string; readonly state: "loading" | "failed" | "refused" | "unread" }

export interface EngineTableProps {
  /** The engines in the surface's order, as the server lists them. */
  readonly engines: readonly EngineRowData[]
  readonly slots: Pick<ScreenSlots, "Table" | "onOpen" | "linkOf">
  /**
   * The column State after the engine: each engine's live state, its verdict where the server
   * decides one (the web app's start page; the editors show no verdict and leave it out).
   */
  readonly withVerdict?: boolean
}

type Words = ReturnType<typeof useEnginesWords>

/**
 * The engine's mark: an engine's, the warning of a read that failed or a refused profile, or a
 * quiet dash where nothing was read for a reason that is not the engine's.
 */
function Mark({ row }: { readonly row: EngineRowData }) {
  if (row.state === "refused") return <Icon icon={Ban} className={TONE_ICON.warning} />
  if (row.state === "failed") return <Icon icon={CircleAlert} className={TONE_ICON.warning} />
  if (row.state === "unread") return <Icon icon={Minus} className="text-muted-foreground" />
  return <Icon icon={Server} className="text-muted-foreground" />
}

/** The engine's cell: its mark and id, and where its row has no figures, why in a quiet word. */
function EngineCell({ row, t }: { readonly row: EngineRowData; readonly t: Words }) {
  return (
    <span className="flex items-center gap-2" data-part="engine" data-state={row.state}>
      <Mark row={row} />
      <span className="font-semibold">{row.engine}</span>
      {row.state !== "read" && (
        <span className="text-muted-foreground">{t(`engines.state.${row.state}`)}</span>
      )}
    </span>
  )
}

/** A figure the row does not have: one quiet em dash, why in its title and for a screen reader. */
function Missing({ why }: { readonly why: string }) {
  return (
    <span title={why} className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{why}</span>
    </span>
  )
}

/** A figure of a read row, else the dash that says why the row has none. */
function figureOf(row: EngineRowData, t: Words, figure: (sums: FleetEngineData) => ReactNode) {
  return row.state === "read" ? figure(row.sums) : <Missing why={t(`engines.state.${row.state}`)} />
}

/** The engine's product and version as its engine screen says them, a dash where it said none. */
function product(sums: FleetEngineData, t: Words): ReactNode {
  return sums.info === null ? (
    <Missing why={t("engines.productUnknown")} />
  ) : (
    `${sums.info.product} ${sums.info.version}`
  )
}

/**
 * The engine's live state: its verdict, a failed read of it or none for an engine of a read row,
 * a dash that says why for a row without figures.
 */
function verdictCell(row: EngineRowData, t: Words): ReactNode {
  if (row.state !== "read") return <Missing why={t(`engines.state.${row.state}`)} />
  const verdict = row.verdict ?? "none"
  const why =
    verdict === "loading" || verdict === "unread"
      ? t(`engines.state.${verdict}`)
      : t("engines.verdict.none")
  return <EngineVerdictCell verdict={verdict} figures={row.sums} why={why} />
}

/**
 * The incidents' column: an engine's root incidents in its processes, named so where an engine of
 * the table holds some outside any process too (`COUNT_TERMS.inProcesses`), which no row counts
 * and the surface shows apart (`OutsideAnyProcessNotice`), as the chat's tile names them.
 */
function incidentsLabel(engines: readonly EngineRowData[], t: Words): string {
  const outside = engines.some((row) => row.state === "read" && (row.outside?.count ?? 0) > 0)
  return t(outside ? "engines.column.incidentsInProcesses" : "engines.column.incidents")
}

function columnsOf(
  t: Words,
  withVerdict: boolean,
  incidents: string,
): ScreenTableColumn<EngineRowData>[] {
  const count = (value: number) => <CountFigure>{formatCount(value)}</CountFigure>
  const state: ScreenTableColumn<EngineRowData>[] = withVerdict
    ? [{ key: "state", label: t("engines.column.state"), cell: (row) => verdictCell(row, t) }]
    : []
  return [
    {
      key: "engine",
      label: t("engines.column.engine"),
      cell: (row) => <EngineCell row={row} t={t} />,
    },
    ...state,
    {
      key: "product",
      label: t("engines.column.product"),
      cell: (row) => figureOf(row, t, (sums) => product(sums, t)),
      hideBelow: "40rem",
    },
    {
      key: "processes",
      label: t("engines.column.processes"),
      cell: (row) => figureOf(row, t, (sums) => count(sums.processes)),
      hideBelow: "40rem",
    },
    {
      key: "running",
      label: t("engines.column.running"),
      cell: (row) => figureOf(row, t, (sums) => count(sums.running)),
      hideBelow: "40rem",
    },
    {
      key: "withIncident",
      label: t("engines.column.withIncident"),
      cell: (row) =>
        figureOf(row, t, (sums) => (
          <IncidentCount
            count={sums.withIncident}
            part="incident-count"
            alarm={t("engines.alarm")}
          />
        )),
    },
    {
      key: "incidents",
      label: incidents,
      cell: (row) =>
        figureOf(row, t, (sums) => (
          <IncidentCount
            count={sums.incidents}
            atLeast={sums.incidentsAtLeast}
            part="root-incident-count"
            alarm={t("engines.alarm")}
          />
        )),
    },
  ]
}

/**
 * The engines side by side, one row each over the surface's table: an engine by its id, on a
 * surface that shows it its live state (`withVerdict`: the verdict's mark of its own shape and its
 * word in its tone, Empty for an ok engine with nothing deployed, a failed read's icon and word, a
 * dash where the server decides none), its product, its processes, running instances, instances
 * with incident and open root incidents, each the figure its engine screen shows (its totals, its
 * rows' incidents summed, a lower bound where the engine stopped counting; `FleetSums`: counts
 * only, never a rate, since engines run different processes), the last named in processes where an
 * engine holds some outside any process too. An engine still read, one whose read failed, a refused
 * profile and one not read for a reason that is not the engine's keep their row, the state in words
 * beside the id and a dash for each figure. A row opens its engine and copies its id; the product,
 * the processes and the running instances drop in a narrow region, the state's word under 28rem,
 * where its mark's shape still says it.
 */
export function EngineTable({ engines, slots, withVerdict = false }: EngineTableProps) {
  const t = useEnginesWords()
  const { Table, onOpen, linkOf } = slots
  const targetOf = (row: EngineRowData): ScreenTarget => ({ kind: "engine", engine: row.engine })
  return (
    <Table<EngineRowData>
      name="engines"
      label={t("engines.label")}
      columns={columnsOf(t, withVerdict, incidentsLabel(engines, t))}
      rows={engines}
      rowKey={(row) => row.engine}
      onOpen={(row, how) => {
        onOpen(targetOf(row), how)
      }}
      {...(linkOf === undefined ? {} : { linkOf: (row: EngineRowData) => linkOf(targetOf(row)) })}
      rowLabel={(row) => t("engines.row", { engine: row.engine })}
      copyOf={(row) => ({ text: row.engine, label: t("engines.id") })}
      empty={t("engines.none")}
    />
  )
}
