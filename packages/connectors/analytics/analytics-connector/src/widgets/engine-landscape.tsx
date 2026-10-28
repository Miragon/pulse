import {
  Badge,
  KpiGrid,
  SectionHeading,
  StatusBadge,
  useToolQuery,
  type KpiCell,
} from "@miragon/mcp-toolkit-ui"
import { Info } from "lucide-react"
import {
  HandOffButton,
  Icon,
  ListTable,
  NamedId,
  TableEmptyState,
  TableSkeleton,
  Td,
  ViewMeta,
  WidgetShell,
  formatNumber,
  type ListTableColumn,
  type ListTableGroup,
} from "@miragon/pulse-widget-shell/widgets"
import type { EngineLandscapeEngine, EngineLandscapeResult } from "@miragon/pulse-analytics-client"
import { ANALYTICS_ENGINE_LANDSCAPE_DATA } from "../tool-names.js"
import { QueryGate } from "./query-gate.js"
import { useT, type T } from "../messages/use-t.js"
import { useHandOff, type HandOff } from "./hand-off.js"
import { processNameOf, type Named } from "../bpmn-names.js"
import { Figure, FigureLegend, Legend, StateCount } from "./figure.js"

/** The landscape payload: the figures plus the process names behind the matrix's keys. */
export type EngineLandscapeView = Named<EngineLandscapeResult>
export type EngineLandscapeData = EngineLandscapeView | null

/** Engine ids from the layout cell props (`engine` may be a string or a list). */
function engineIdsFromProps(engine: string | string[] | undefined): string[] {
  if (typeof engine === "string") return engine.length > 0 ? [engine] : []
  if (Array.isArray(engine)) return engine.filter((id) => typeof id === "string" && id.length > 0)
  return []
}

/**
 * Deliberately NOT an engine scoreboard: engines run different processes, so a per-engine rate
 * describes the mix. "—" means not measured; an undeployed process is an empty cell.
 */
export function EngineLandscapeWidget({
  data: initialData,
  engine,
}: {
  data: EngineLandscapeData
  /** Engine ids to include; pass all configured ones to surface silent engines. */
  engine?: string | string[]
}) {
  const t = useT()
  const engineIds = engineIdsFromProps(engine)
  const query = useToolQuery<EngineLandscapeView>(
    // The engine scope belongs in the key: a subset view must not read the
    // full-fleet payload out of the cache.
    ["analytics:engine-landscape", engineIds.join(",")],
    ANALYTICS_ENGINE_LANDSCAPE_DATA,
    engineIds.length > 0 ? { engine: engineIds } : {},
    { enabled: !initialData },
  )

  return (
    <QueryGate initialData={initialData} query={query} skeleton={<TableSkeleton />}>
      {(data) => (
        <WidgetShell>
          <LandscapeSummary data={data} t={t} />
          <EngineTable data={data} t={t} />
          <ProcessMatrix data={data} t={t} />
        </WidgetShell>
      )}
    </QueryGate>
  )
}

function LandscapeSummary({ data, t }: { data: EngineLandscapeView; t: T }) {
  const { totals } = data
  const silent = totals.engineCount - totals.reportingEngineCount
  const cells: KpiCell[] = [
    {
      label: t("aLandscape.kpiEngines"),
      value: formatNumber(totals.engineCount),
      // An engine without metrics may be down: worth a look, not an error.
      trend:
        silent > 0 ? t("aLandscape.kpiEnginesSilent", { count: formatNumber(silent) }) : undefined,
      trendTone: silent > 0 ? "warning" : undefined,
    },
    {
      label: t("aLandscape.kpiProcesses"),
      value: formatNumber(totals.processKeyCount),
      trend: t("aLandscape.kpiProcessesShared", {
        count: formatNumber(totals.sharedProcessKeyCount),
      }),
    },
    { label: t("aLandscape.kpiRunning"), value: formatNumber(totals.runningInstances) },
    {
      label: t("aLandscape.kpiIncidents"),
      value: formatNumber(totals.openIncidents),
      tone: (totals.openIncidents ?? 0) > 0 ? "danger" : undefined,
    },
  ]
  return (
    <>
      <SectionHeading title={t("aLandscape.heading")} hint={t("aLandscape.headingHint")} />
      {/* A live snapshot: no period, the engines (and how many send no metrics) and when. */}
      <ViewMeta
        className="-mt-2 mb-3"
        engines={{ count: totals.engineCount, silent }}
        asOf={data.asOf}
      />
      <KpiGrid cells={cells} />
    </>
  )
}

/**
 * The backlog gauges carry no process label, so they genuinely compare engines and never hide; only
 * the inventory column gives way below 768 px.
 */
function engineColumns(t: T): ListTableColumn[] {
  return [
    { label: t("aLandscape.colEngine") },
    { label: t("aLandscape.colRunning"), align: "right" },
    { label: t("aLandscape.colIncidents"), align: "right" },
    { label: t("aLandscape.colFailedJobs"), align: "right" },
    { label: t("aLandscape.colExecutable"), align: "right" },
    { label: t("aLandscape.colSuspended"), align: "right" },
    { label: t("aLandscape.colDueFuture"), align: "right" },
    { label: t("aLandscape.colExternalTasks"), align: "right" },
    { label: t("aLandscape.colProcesses"), align: "right", hideBelow: "md" },
  ]
}

function engineGroups(t: T): ListTableGroup[] {
  return [
    {},
    { label: t("aLandscape.groupLoad"), span: 3 },
    { label: t("aLandscape.groupBacklog"), span: 4 },
    {},
  ]
}

/** One count of an engine: the number, or "—" with its meaning for an engine without metrics. */
function CountCell({ value, t }: { value: number | null; t: T }) {
  return (
    <Td align="right" className="tabular-nums">
      <Figure value={value} why={t("aLandscape.unknown")} />
    </Td>
  )
}

/** A danger edge while there are any, as camunda7's engine tiles show the same counts. */
function StateCountCell({ value, t }: { value: number | null; t: T }) {
  return (
    <Td align="right" className="tabular-nums">
      <StateCount value={value} why={t("aLandscape.unknown")} />
    </Td>
  )
}

function EngineRow({ engine: e, t }: { engine: EngineLandscapeEngine; t: T }) {
  return (
    <tr>
      <Td>
        <span className="flex flex-wrap items-center gap-2">
          {/* An engine id is short and one word ("prod-a"): never wrapped. */}
          <span className="font-mono font-medium whitespace-nowrap">{e.engineId}</span>
          {/* The badge may go under the id in a narrow column, but never
              breaks inside itself ("no / metrics"): a pill is one line. */}
          {!e.reporting && (
            <StatusBadge tone="warning" className="whitespace-nowrap">
              {t("aLandscape.noMetrics")}
            </StatusBadge>
          )}
        </span>
      </Td>
      <CountCell value={e.runningInstances} t={t} />
      <StateCountCell value={e.openIncidents} t={t} />
      <StateCountCell value={e.failedJobs} t={t} />
      <CountCell value={e.executableJobs} t={t} />
      <CountCell value={e.suspendedJobs} t={t} />
      <CountCell value={e.jobsDueFuture} t={t} />
      <CountCell value={e.openExternalTasks} t={t} />
      <Td align="right" className="tabular-nums">
        <Figure value={e.deployedDefinitionKeys} why={t("aLandscape.unknown")} />
        {(e.exclusiveDefinitionKeys ?? 0) > 0 && (
          <span className="text-muted-foreground text-small ml-1 whitespace-nowrap">
            {t("aLandscape.exclusiveSuffix", {
              count: formatNumber(e.exclusiveDefinitionKeys),
            })}
          </span>
        )}
      </Td>
    </tr>
  )
}

function EngineTable({ data, t }: { data: EngineLandscapeView; t: T }) {
  if (data.engines.length === 0) {
    return <TableEmptyState>{t("aLandscape.emptyEngines")}</TableEmptyState>
  }
  return (
    <section>
      <SectionHeading title={t("aLandscape.engines.title")} hint={t("aLandscape.engines.hint")} />
      <ListTable
        ariaLabel={t("aLandscape.engines.tableLabel")}
        columns={engineColumns(t)}
        groups={engineGroups(t)}
        // Eight figures side by side: the compact cell padding keeps every
        // backlog column in a 760 px inline view, in German too.
        className="[&_td]:px-3 [&_th]:px-3"
      >
        {data.engines.map((e) => (
          <EngineRow key={e.engineId} engine={e} t={t} />
        ))}
      </ListTable>
      <FigureLegend reasons={[data.engines.some((e) => !e.reporting) && t("aLandscape.unknown")]} />
    </section>
  )
}

/**
 * Shared definitions lead and alone offer the KPI comparison. Columns are the engines that send
 * metrics; the comparison is pinned right to stay in reach.
 */
function ProcessMatrix({ data, t }: { data: EngineLandscapeView; t: T }) {
  if (data.processes.length === 0) {
    return <TableEmptyState>{t("aLandscape.emptyProcesses")}</TableEmptyState>
  }
  const engineIds = data.engines.filter((e) => e.reporting).map((e) => e.engineId)
  const silent = data.engines.filter((e) => !e.reporting).map((e) => e.engineId)
  const columns: ListTableColumn[] = [
    { label: t("aLandscape.colProcess") },
    ...engineIds.map((id): ListTableColumn => ({
      label: <span className="font-mono">{id}</span>,
      align: "right",
    })),
    { label: t("aLandscape.colIncidents"), align: "right" },
    {
      label: <span className="sr-only">{t("aLandscape.colCompare")}</span>,
      plain: true,
      sticky: true,
    },
  ]
  return (
    <section>
      <SectionHeading title={t("aLandscape.matrix.title")} hint={t("aLandscape.matrix.hint")} />
      <p className="text-muted-foreground text-small mb-3 flex items-start gap-2">
        <Icon icon={Info} dense className="mt-0.5" />
        <span>{t("aLandscape.mixNote")}</span>
      </p>
      <ListTable ariaLabel={t("aLandscape.matrix.tableLabel")} columns={columns}>
        {data.processes.map((p) => (
          <tr key={p.processDefinitionKey}>
            <Td>
              <span className="flex flex-wrap items-center gap-2">
                <NamedId
                  name={processNameOf(data.names, p.processDefinitionKey)}
                  id={p.processDefinitionKey}
                />
                {p.shared && (
                  <Badge variant="outline">
                    {t("aLandscape.sharedBadge", { count: formatNumber(p.engineIds.length) })}
                  </Badge>
                )}
              </span>
            </Td>
            {engineIds.map((id) => (
              <Td key={id} align="right" className="tabular-nums">
                {p.engineIds.includes(id) ? (
                  formatNumber(p.runningByEngine[id] ?? 0)
                ) : (
                  // Not deployed: an empty cell (the legend says so), never "—".
                  <span className="sr-only">{t("aLandscape.notDeployed")}</span>
                )}
              </Td>
            ))}
            <Td align="right" className="tabular-nums">
              <StateCount value={p.openIncidentsTotal} />
            </Td>
            <Td align="right">
              {p.shared && (
                <CompareAction processKey={p.processDefinitionKey} on={p.engineIds} t={t} />
              )}
            </Td>
          </tr>
        ))}
      </ListTable>
      <Legend>{t("aLandscape.legendNotDeployed")}</Legend>
      {silent.length > 0 && (
        <Legend>
          {t("aLandscape.silentNote", {
            count: formatNumber(silent.length),
            engines: silent.join(", "),
          })}
        </Legend>
      )}
    </section>
  )
}

/**
 * The one valid engine-vs-engine hand-off: same process, two engines (further engines named so the
 * model can pair them next).
 */
export function landscapeCompareHandOff(processKey: string, on: readonly string[]): HandOff {
  const [engineA, engineB, ...more] = on
  return {
    intent: "askAi.landscapeCompare",
    ids: { processDefinitionKey: processKey, engineA, engineB, windowDays: 14 },
    facts: { alsoRunsOn: more.length > 0 ? more : undefined },
    tools: ["analytics_show_engine_compare"],
  }
}

function CompareAction({ processKey, on, t }: { processKey: string; on: string[]; t: T }) {
  const { ask } = useHandOff()
  return (
    <HandOffButton
      action="compareEngines"
      variant="icon"
      title={t("aLandscape.compareLabel", { key: processKey })}
      prompt={ask(landscapeCompareHandOff(processKey, on))}
    />
  )
}
