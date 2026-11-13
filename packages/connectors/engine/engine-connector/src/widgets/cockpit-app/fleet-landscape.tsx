import {
  Badge,
  CountPill,
  Icon,
  KpiGrid,
  NamedId,
  SectionHeading,
  TableEmptyState,
  Td,
  countTone,
  formatCount,
  formatNumber,
  type KpiCell,
  SITUATION_TONES,
} from "@miragon/pulse-ui"
import {
  ListTable,
  TableSkeleton,
  useToolQueries,
  type ListTableColumn,
  type ListTableGroup,
} from "@miragon/pulse-widget-shell/widgets"
import { Info } from "lucide-react"
import {
  foldFleetLandscape,
  type FleetLandscapeFigures,
  type LandscapeEngine,
} from "../../lib/shared/fleet-landscape.js"
import { useT, type T } from "../../messages/use-t.js"
import {
  HEALTH_FAILURE_TONE,
  HEALTH_FAILURES,
  healthFailureOf,
  type HealthFailure,
} from "../lib/health-verdict.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_JOB_BACKLOG_DATA } from "../../tool-names.js"
import type { CockpitDashboardData, JobBacklogData } from "../../view-models.js"

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
  return healthFailureOf(overview.error)
}

/** Each failure counted under its own word, in the order of {@link HEALTH_FAILURES}. */
const FAILURE_COUNT: Readonly<Record<HealthFailure, string>> = {
  unreachable: "fleet.landscape.kpiUnreachable",
  refused: "fleet.landscape.kpiRefused",
  unauthorized: "fleet.landscape.kpiUnauthorized",
  forbidden: "fleet.landscape.kpiForbidden",
}

interface Landscape {
  figures: FleetLandscapeFigures
  states: Record<string, EngineState>
}

/**
 * Each engine's overview under the key the engine cards read it by (`useEngineHealth`), so the
 * landscape adds no read of its own there, plus its job backlog; both under the cockpit's Refresh.
 */
function useLandscape(engineIds: readonly string[]): Landscape {
  const overviews = useToolQueries<CockpitDashboardData>(
    engineIds.map((id) => ({
      key: ["engine:cockpit-overview", id],
      tool: ENGINE_COCKPIT_OVERVIEW_DATA,
      args: { engine: id },
    })),
  )
  const backlogs = useToolQueries<JobBacklogData>(
    engineIds.map((id) => ({
      key: ["engine:job-backlog", id],
      tool: ENGINE_JOB_BACKLOG_DATA,
      args: { engine: id },
    })),
  )
  const states: Record<string, EngineState> = {}
  const reads = engineIds.map((engineId, i) => {
    const overview = overviews[i]
    states[engineId] = stateOf(overview)
    return {
      engineId,
      definitions: overview?.data?.definitions ?? null,
      backlog: backlogs[i]?.data ?? null,
    }
  })
  return { figures: foldFleetLandscape(reads), states }
}

/** A sum over the read engines: a lower bound while an engine is not read, "—" while none is. */
function totalOf(value: number | null, complete: boolean): string {
  return formatCount(value === null || complete ? value : { atLeast: value })
}

function LandscapeKpis({ figures, states, t }: Landscape & { t: T }) {
  const { totals } = figures
  const complete = totals.readEngineCount === totals.engineCount
  // No engine read yet: no count of processes either, never a 0.
  const processes = totals.readEngineCount === 0 ? null : totals.processKeyCount
  const failures = HEALTH_FAILURES.map((failure) => ({
    failure,
    count: Object.values(states).filter((state) => state === failure).length,
  })).filter(({ count }) => count > 0)
  const trend = failures.map(({ failure, count }) =>
    t(FAILURE_COUNT[failure], { count: formatNumber(count) }),
  )
  // The worst failure's tone: an unreachable engine over a refused profile or login.
  const tones = failures.map(({ failure }) => HEALTH_FAILURE_TONE[failure])
  const cells: KpiCell[] = [
    {
      label: t("fleet.landscape.kpiEngines"),
      value: formatNumber(totals.engineCount),
      trend: trend.length > 0 ? trend.join(" · ") : undefined,
      trendTone: tones.includes("danger")
        ? "danger"
        : tones.includes("warning")
          ? "warning"
          : undefined,
    },
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
      value: totalOf(totals.openIncidents, complete),
      tone: (totals.openIncidents ?? 0) > 0 ? SITUATION_TONES.openIncident : undefined,
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

/** A count that is a state: a danger pill while there are any, as the engine cards show it. */
function StateCount({ value, t }: { value: number | null; t: T }) {
  const tone = countTone(value)
  if (tone === SITUATION_TONES.openIncident) {
    return <CountPill tone={tone}>{formatNumber(value)}</CountPill>
  }
  return <Figure value={value} t={t} />
}

function CountCell({ value, state, t }: { value: number | null; state?: boolean; t: T }) {
  return (
    <Td align="right" className="tabular-nums">
      {state ? <StateCount value={value} t={t} /> : <Figure value={value} t={t} />}
    </Td>
  )
}

/** The backlog carries no process, so it alone compares engines; the inventory gives way below 768 px. */
function engineColumns(t: T): ListTableColumn[] {
  return [
    { label: t("fleet.landscape.colEngine") },
    { label: t("fleet.landscape.colRunning"), align: "right" },
    { label: t("fleet.landscape.colIncidents"), align: "right" },
    { label: t("fleet.landscape.colFailedJobs"), align: "right" },
    { label: t("fleet.landscape.colExecutable"), align: "right" },
    { label: t("fleet.landscape.colSuspended"), align: "right" },
    { label: t("fleet.landscape.colDueLater"), align: "right" },
    { label: t("fleet.landscape.colExternalTasks"), align: "right" },
    { label: t("fleet.landscape.colDefinitions"), align: "right", hideBelow: "md" },
  ]
}

function engineGroups(t: T): ListTableGroup[] {
  return [
    {},
    { label: t("fleet.landscape.groupLoad"), span: 3 },
    { label: t("fleet.landscape.groupBacklog"), span: 4 },
    {},
  ]
}

function EngineRow({ engine: e, state, t }: { engine: LandscapeEngine; state: EngineState; t: T }) {
  return (
    <tr>
      <Td>
        <span className="flex flex-wrap items-center gap-2">
          {/* An engine id is short and one word ("prod-a"): never wrapped. */}
          <span className="font-mono font-semibold whitespace-nowrap">{e.engineId}</span>
          {/* The engine card's words, which may wrap: the backlog columns keep their room. */}
          {state !== "read" && (
            <span className="text-muted-foreground text-small">
              {t(`cockpit.landing.status.${state}`)}
            </span>
          )}
        </span>
      </Td>
      <CountCell value={e.runningInstances} t={t} />
      <CountCell value={e.openIncidents} state t={t} />
      <CountCell value={e.failedJobs} state t={t} />
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
    </tr>
  )
}

function Legend({ children }: { children: string }) {
  return <p className="text-muted-foreground text-small mt-2">{children}</p>
}

function EngineTable({ figures, states, t }: Landscape & { t: T }) {
  const unknown = figures.engines.some((e) => !e.read || e.executableJobs === null)
  return (
    <section>
      <SectionHeading
        title={t("fleet.landscape.engines.title")}
        hint={t("fleet.landscape.engines.hint")}
      />
      <ListTable
        ariaLabel={t("fleet.landscape.engines.tableLabel")}
        columns={engineColumns(t)}
        groups={engineGroups(t)}
        // Eight figures side by side: the compact cell padding keeps every
        // backlog column in a 760 px inline view, in German too.
        className="[&_td]:px-3 [&_th]:px-3"
      >
        {figures.engines.map((e) => (
          <EngineRow key={e.engineId} engine={e} state={states[e.engineId] ?? "loading"} t={t} />
        ))}
      </ListTable>
      {unknown && <Legend>{`${formatNumber(null)} ${t("fleet.landscape.unknown")}`}</Legend>}
    </section>
  )
}

/** Shared definitions lead; the columns are the engines read, a missing one named below. */
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
    ...engineIds.map((id): ListTableColumn => ({
      label: <span className="font-mono">{id}</span>,
      align: "right",
    })),
    { label: t("fleet.landscape.colIncidents"), align: "right" },
  ]
  return (
    <section>
      <SectionHeading
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
                {p.shared && (
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
              <StateCount value={p.openIncidentsTotal} t={t} />
            </Td>
          </tr>
        ))}
      </ListTable>
      <Legend>{t("fleet.landscape.legendNotDeployed")}</Legend>
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
 * and no column, never a row of zeros.
 */
export function FleetLandscape({ engineIds }: { engineIds: readonly string[] }) {
  const t = useT()
  const landscape = useLandscape(engineIds)
  return (
    <section aria-label={t("fleet.landscape.title")} className="flex flex-col gap-6">
      <div>
        <SectionHeading title={t("fleet.landscape.title")} hint={t("fleet.landscape.hint")} />
        <LandscapeKpis {...landscape} t={t} />
      </div>
      <EngineTable {...landscape} t={t} />
      <ProcessMatrix {...landscape} t={t} />
    </section>
  )
}
