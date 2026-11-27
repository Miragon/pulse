import {
  Badge,
  Icon,
  KpiGrid,
  NamedId,
  SectionHeading,
  TableEmptyState,
  Td,
  formatCount,
  formatNumber,
  type KpiCell,
} from "@miragon/pulse-ui"
import {
  ListRow,
  ListTable,
  TableSkeleton,
  useToolQueries,
  type ListTableColumn,
} from "@miragon/pulse-widget-shell/widgets"
import { Info } from "lucide-react"
import {
  foldFleetLandscape,
  type FleetLandscapeFigures,
  type LandscapeEngine,
} from "../../lib/shared/fleet-landscape.js"
import { useT, type T } from "../../messages/use-t.js"
import { healthFailureOf, type HealthFailure } from "../lib/health-verdict.js"
import { AlarmCount, type CountAlarm } from "../lib/alarm-count.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_JOB_BACKLOG_DATA } from "../../tool-names.js"
import type { CockpitDashboardData, JobBacklogData } from "../../view-models.js"
import { useEngineHealth } from "./engine-health.js"
import { FleetRowWords } from "./engine-row-status.js"
import { engineStatusKind, StatusMark } from "./engine-status.js"

/**
 * Where an engine's overview stands: the chooser's words for it (#322 U15). A refused profile or
 * login is no outage: the server never asks the one engine, and the other answered.
 */
type EngineState = "read" | "loading" | HealthFailure

function stateOf(
  overview: { data?: unknown; isError: boolean; error: unknown } | undefined,
): EngineState {
  if (overview?.data) return "read"
  if (!overview?.isError) return "loading"
  // A page whose session ended read no engine: not read, never a failure of the engine's.
  return healthFailureOf(overview.error) ?? "loading"
}

interface Landscape {
  figures: FleetLandscapeFigures
  states: Record<string, EngineState>
}

/**
 * Each engine's overview under the key its row's verdict reads it by (`useEngineHealth`), so the
 * landscape adds no read of its own there, plus its job backlog; both under the cockpit's Refresh.
 * A profile the server refused it never reads: it counts as refused, as its row says.
 */
function useLandscape(engineIds: readonly string[], refused: ReadonlySet<string>): Landscape {
  const readIds = engineIds.filter((id) => !refused.has(id))
  const overviews = useToolQueries<CockpitDashboardData>(
    readIds.map((id) => ({
      key: ["engine:cockpit-overview", id],
      tool: ENGINE_COCKPIT_OVERVIEW_DATA,
      args: { engine: id },
    })),
  )
  const backlogs = useToolQueries<JobBacklogData>(
    readIds.map((id) => ({
      key: ["engine:job-backlog", id],
      tool: ENGINE_JOB_BACKLOG_DATA,
      args: { engine: id },
    })),
  )
  const read = new Map(
    readIds.map((id, i) => [id, { overview: overviews[i], backlog: backlogs[i] }]),
  )
  const states: Record<string, EngineState> = {}
  const reads = engineIds.map((engineId) => {
    const answers = read.get(engineId)
    states[engineId] = answers === undefined ? "refused" : stateOf(answers.overview)
    return {
      engineId,
      definitions: answers?.overview?.data?.definitions ?? null,
      backlog: answers?.backlog?.data ?? null,
    }
  })
  return { figures: foldFleetLandscape(reads), states }
}

/** A sum over the read engines: a lower bound while an engine is not read, "—" while none is. */
function totalOf(value: number | null, complete: boolean): string {
  return formatCount(value === null || complete ? value : { atLeast: value })
}

/**
 * The sums over the engines read. The engines themselves the header counts and the table rows,
 * each with its state: no tile repeats them (N8).
 */
function LandscapeKpis({ figures, t }: { figures: FleetLandscapeFigures; t: T }) {
  const { totals } = figures
  const complete = totals.readEngineCount === totals.engineCount
  // No engine read yet: no count of processes either, never a 0.
  const processes = totals.readEngineCount === 0 ? null : totals.processKeyCount
  const cells: KpiCell[] = [
    {
      label: t("fleet.landscape.kpiProcesses"),
      value: totalOf(processes, complete),
      trend: t("fleet.landscape.kpiShared", {
        count: formatNumber(totals.sharedProcessKeyCount),
      }),
    },
    {
      label: t("fleet.landscape.kpiRunning"),
      value: totalOf(totals.runningInstances, complete),
    },
    {
      label: t("fleet.landscape.kpiIncidents"),
      value: (
        <AlarmCount alarm={(totals.openIncidents ?? 0) > 0 && "openIncidents"}>
          {totalOf(totals.openIncidents, complete)}
        </AlarmCount>
      ),
    },
  ]
  return <KpiGrid cells={cells} />
}

/** A count; "—" with its meaning in words when the engine did not answer it (#322 U17). */
function Figure({ value, t }: { value: number | null; t: T }) {
  if (value !== null) return <>{formatNumber(value)}</>
  const why = t("fleet.landscape.unknown")
  return (
    <span title={why}>
      <span aria-hidden="true">{formatNumber(null)}</span>
      <span className="sr-only">{why}</span>
    </span>
  )
}

/**
 * A count that is a state: a neutral number that alarms by its icon and words while there are
 * any, as the overview shows it (invariant 6).
 */
function StateCount({ value, alarm, t }: { value: number | null; alarm: CountAlarm; t: T }) {
  if (value === null || value <= 0) return <Figure value={value} t={t} />
  return <AlarmCount alarm={alarm}>{formatNumber(value)}</AlarmCount>
}

function CountCell({ value, alarm, t }: { value: number | null; alarm?: CountAlarm; t: T }) {
  return (
    <Td align="right" className="tabular-nums">
      {alarm ? <StateCount value={value} alarm={alarm} t={t} /> : <Figure value={value} t={t} />}
    </Td>
  )
}

/**
 * The backlog carries no process, so it alone compares engines; it gives way below 40rem of the
 * table's region, the inventory below 48rem (a 760 px chat keeps the backlog), the load never.
 */
function engineColumns(t: T): ListTableColumn[] {
  return [
    { label: t("fleet.landscape.colEngine") },
    { label: t("fleet.landscape.colRunning"), align: "right" },
    { label: t("fleet.landscape.colIncidents"), align: "right" },
    { label: t("fleet.landscape.colFailedJobs"), align: "right" },
    { label: t("fleet.landscape.colExecutable"), align: "right", hideBelow: "sm" },
    { label: t("fleet.landscape.colSuspended"), align: "right", hideBelow: "sm" },
    { label: t("fleet.landscape.colDueLater"), align: "right", hideBelow: "sm" },
    { label: t("fleet.landscape.colExternalTasks"), align: "right", hideBelow: "sm" },
    { label: t("fleet.landscape.colDefinitions"), align: "right", hideBelow: "md" },
  ]
}

interface EngineRowProps {
  engine: LandscapeEngine
  state: EngineState
  onEnter: (engineId: string) => void
  t: T
}

/** The engine's verdict, as the landing's row shows it: its dot, or a failed read's icon. */
function VerdictMark({ engineId }: { engineId: string }) {
  const { failure, summary, status, tone } = useEngineHealth(engineId)
  return <StatusMark kind={engineStatusKind({ failure, summary, status })} tone={tone} />
}

/**
 * A row opens its engine on a click or Enter (the row convention, N8), the engine's verdict before
 * its id, which stands in the sans of the landing's rows; a profile the server refused reads
 * nothing, so its mark is a refused profile's.
 */
function EngineRow({ engine: e, state, onEnter, t }: EngineRowProps) {
  return (
    <ListRow
      label={t("fleet.landscape.engineRow", { engine: e.engineId })}
      onOpen={() => onEnter(e.engineId)}
      copy={e.engineId}
    >
      <Td>
        <span className="flex flex-wrap items-center gap-2">
          {state === "refused" ? (
            <StatusMark kind="refused" tone="neutral" />
          ) : (
            <VerdictMark engineId={e.engineId} />
          )}
          {/* An engine id is short and one word ("prod-a"): never wrapped. */}
          <span className="font-semibold whitespace-nowrap">{e.engineId}</span>
          {/* The landing's words, which may wrap: the figures keep their room. */}
          <FleetRowWords engineId={e.engineId} state={state} t={t} />
        </span>
      </Td>
      <CountCell value={e.runningInstances} t={t} />
      <CountCell value={e.openIncidents} alarm="openIncidents" t={t} />
      <CountCell value={e.failedJobs} alarm="jobsWithoutRetries" t={t} />
      <CountCell value={e.executableJobs} t={t} />
      <CountCell value={e.suspendedJobs} t={t} />
      <CountCell value={e.jobsDueLater} t={t} />
      <CountCell value={e.externalTasks} t={t} />
      <Td align="right" className="tabular-nums">
        <Figure value={e.definitionKeys} t={t} />
        {(e.exclusiveDefinitionKeys ?? 0) > 0 && (
          <span className="text-muted-foreground text-small ml-1 whitespace-nowrap">
            {t("fleet.landscape.exclusiveSuffix", {
              count: formatNumber(e.exclusiveDefinitionKeys),
            })}
          </span>
        )}
      </Td>
    </ListRow>
  )
}

function Legend({ children }: { children: string }) {
  return <p className="text-muted-foreground text-small mt-2">{children}</p>
}

function EngineTable({
  figures,
  states,
  onEnterEngine,
  t,
}: Landscape & { onEnterEngine: (engineId: string) => void; t: T }) {
  const unknown = figures.engines.some((e) => !e.read || e.executableJobs === null)
  return (
    <section>
      <SectionHeading as="h3" title={t("fleet.landscape.engines.title")} />
      <ListTable
        ariaLabel={t("fleet.landscape.engines.tableLabel")}
        columns={engineColumns(t)}
        // Eight figures side by side: the density's cell padding and captions that
        // wrap keep every backlog column in a 760 px inline view, in German too.
        wrapHeads
      >
        {figures.engines.map((e) => (
          <EngineRow
            key={e.engineId}
            engine={e}
            state={states[e.engineId] ?? "loading"}
            onEnter={onEnterEngine}
            t={t}
          />
        ))}
      </ListTable>
      {unknown && <Legend>{`${formatNumber(null)} ${t("fleet.landscape.unknown")}`}</Legend>}
    </section>
  )
}

/**
 * Shared definitions lead; the columns are the engines read, a missing one named below. A process
 * on some engines only says on how many; one on every engine says nothing more than its cells
 * (D14), and an empty cell, not deployed there, needs no legend.
 */
function ProcessMatrix({ figures, states, t }: Landscape & { t: T }) {
  const engineIds = figures.engines.filter((e) => e.read).map((e) => e.engineId)
  const unread = figures.engines.filter((e) => !e.read).map((e) => e.engineId)
  if (figures.processes.length === 0) {
    if (Object.values(states).includes("loading")) return <TableSkeleton />
    return (
      <TableEmptyState>
        {t(engineIds.length === 0 ? "fleet.landscape.noAnswer" : "fleet.landscape.noDefinitions")}
      </TableEmptyState>
    )
  }
  const columns: ListTableColumn[] = [
    { label: t("fleet.landscape.colProcess") },
    ...engineIds.map((id): ListTableColumn => ({ label: id, align: "right" })),
    { label: t("fleet.landscape.colIncidents"), align: "right" },
  ]
  return (
    <section>
      <SectionHeading
        as="h3"
        title={t("fleet.landscape.matrix.title")}
        hint={t("fleet.landscape.matrix.hint")}
      />
      <p className="text-muted-foreground text-small mb-3 flex items-start gap-2">
        <Icon icon={Info} dense className="mt-0.5" />
        <span>{t("fleet.landscape.mixNote")}</span>
      </p>
      <ListTable ariaLabel={t("fleet.landscape.matrix.tableLabel")} columns={columns}>
        {figures.processes.map((p) => (
          <tr key={p.processDefinitionKey}>
            <Td>
              <span className="flex flex-wrap items-center gap-2">
                <NamedId name={p.name} id={p.processDefinitionKey} />
                {p.shared && p.engineIds.length < engineIds.length && (
                  <Badge variant="outline">
                    {t("fleet.landscape.sharedBadge", { count: formatNumber(p.engineIds.length) })}
                  </Badge>
                )}
              </span>
            </Td>
            {engineIds.map((id) => (
              <Td key={id} align="right" className="tabular-nums">
                {Object.hasOwn(p.runningByEngine, id) ? (
                  formatNumber(p.runningByEngine[id])
                ) : (
                  // Not deployed: an empty cell (the legend says so), never "—".
                  <span className="sr-only">{t("fleet.landscape.notDeployed")}</span>
                )}
              </Td>
            ))}
            <Td align="right" className="tabular-nums">
              <StateCount value={p.openIncidentsTotal} alarm="openIncidents" t={t} />
            </Td>
          </tr>
        ))}
      </ListTable>
      {unread.length > 0 && (
        <Legend>
          {t("fleet.landscape.unreadNote", {
            count: formatNumber(unread.length),
            engines: unread.join(", "),
          })}
        </Legend>
      )}
    </section>
  )
}

/**
 * What runs where across the engines, from each engine's own REST API: counts only, never a
 * ranking (`lib/shared/fleet-landscape.ts`). An engine that does not answer is a row in words
 * and no column, never a row of zeros; each engine's row opens it.
 */
export function FleetLandscape({
  engineIds,
  refused = new Set(),
  onEnterEngine,
}: {
  engineIds: readonly string[]
  /** The engines of `engineIds` whose profile the server refused: never read. */
  refused?: ReadonlySet<string>
  onEnterEngine: (engineId: string) => void
}) {
  const t = useT()
  const landscape = useLandscape(engineIds, refused)
  return (
    <section aria-label={t("fleet.landscape.title")} className="gap-section flex flex-col">
      <div>
        <SectionHeading as="h2" title={t("fleet.landscape.title")} />
        <LandscapeKpis figures={landscape.figures} t={t} />
      </div>
      <EngineTable {...landscape} onEnterEngine={onEnterEngine} t={t} />
      <ProcessMatrix {...landscape} t={t} />
    </section>
  )
}
