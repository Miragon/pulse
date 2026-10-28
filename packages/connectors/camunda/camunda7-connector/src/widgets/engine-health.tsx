import { useId } from "react"
import {
  Button,
  ErrorState,
  KpiGrid,
  StatusBadge,
  WidgetHeader,
  type ToneVariant,
  DrillButton,
} from "@miragon/mcp-toolkit-ui"
import {
  HandOffButton,
  Icon,
  NamedId,
  ViewDataState,
  WidgetShell,
  formatNumber,
  viewRefreshState,
} from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw, TriangleAlert } from "lucide-react"
import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import { useViewData } from "@miragon/mcp-toolkit-ui/hooks"
import type { EngineHealthCluster, EngineHealthData, EngineHealthStatus } from "../view-models.js"
import { useNav, type OnNavigate } from "./navigation.js"
import { CAMUNDA7_ENGINE_HEALTH_DATA } from "../tool-names.js"
import { remediationHandOff, UNKNOWN_KEY as UNKNOWN } from "./remediation.js"
import { useHandOff, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { formatCount, formatCountAtLeast } from "./lib/format-count.js"
import { healthVerdictLine } from "./lib/health-verdict.js"
import { EngineMeta, useEngineInChrome } from "./lib/engine-context.js"
import { useT } from "../messages/use-t.js"

const STATUS: Record<EngineHealthStatus, { tone: ToneVariant; labelKey: string }> = {
  ok: { tone: "success", labelKey: "engineHealth.statusStable" },
  degraded: { tone: "warning", labelKey: "engineHealth.statusDegraded" },
  critical: { tone: "danger", labelKey: "engineHealth.statusCritical" },
}

/** An engine with nothing deployed is neutral, never a green check over an empty engine (#322 U14). */
function verdictBadge(data: EngineHealthData): { tone: ToneVariant; labelKey: string } {
  if (data.summary.totalDefinitions === 0 && data.summary.totalIncidents === 0) {
    return { tone: "neutral", labelKey: "engineHealth.statusNothingDeployed" }
  }
  return STATUS[data.status]
}

function clusterActivities(data: EngineHealthData): string[] {
  return data.clusters.map((c) => c.activityId)
}

/** Grounding context, so the operator never restates what they are looking at. */
export function describeHealth(data: EngineHealthData, engine?: string): ViewContext {
  const { summary, clusters, status } = data
  const top = clusters[0]
  return {
    summary: "The operator is viewing the engine health overview of one engine.",
    ids: { engine: engine ?? data.engineId },
    facts: {
      verdict: status,
      openIncidents: summary.totalIncidents,
      lastHour: summary.lastHourIncidents,
      last24h: summary.last24hIncidents,
      affectedActivities: summary.affectedActivities,
      affectedDefinitions: summary.affectedDefinitions,
      runningInstances: summary.runningInstances,
      started24h: summary.started24h,
      completed24h: summary.completed24h,
      topClusterActivity: top?.activityId,
      topClusterType: top?.incidentType,
      // A capped scan vouches only for the cluster's scanned share (#335).
      topClusterIncidents: top?.incidentCount ?? undefined,
      topClusterIncidentsAtLeast:
        top?.incidentCount === null ? top.scannedIncidentCount : undefined,
    },
    tools: [
      "analytics_engine_health",
      "analytics_show_failure_dashboard",
      "camunda7_list_incidents",
      "camunda7_show_cluster_detail",
    ],
  }
}

export function triageHandOff(data: EngineHealthData, engine?: string): HandOff {
  const { summary } = data
  return {
    intent: "askAi.health.triage",
    ids: { engine: engine ?? data.engineId },
    facts: {
      openIncidents: summary.totalIncidents,
      lastHour: summary.lastHourIncidents,
      last24h: summary.last24hIncidents,
      affectedActivities: summary.affectedActivities,
      affectedDefinitions: summary.affectedDefinitions,
      runningInstances: summary.runningInstances,
      clusterActivities: clusterActivities(data),
    },
    tools: [
      "analytics_engine_health",
      "analytics_show_failure_dashboard",
      "camunda7_list_incidents",
      "camunda7_query_historic_incidents",
    ],
  }
}

/** An unreachable engine is itself an incident: hand it to the agent. The error text is quoted, never inlined. */
export function diagnoseHandOff(engine: string | undefined, message: string): HandOff {
  return {
    intent: "askAi.health.diagnoseUnreachable",
    ids: { engine, maxResults: 1 },
    untrusted: [{ label: "error", text: message }],
    tools: ["camunda7_list_engines", "camunda7_list_process_definitions"],
  }
}

/** One cross-process incident cluster (#322 U12): its state is the count, so the type is a neutral chip. */
function ClusterRow({
  cluster,
  engine,
  go,
}: {
  cluster: EngineHealthCluster
  engine?: string
  go: OnNavigate
}) {
  const t = useT()
  const { ask, surface } = useHandOff()
  const { handOff, canFix } = remediationHandOff(cluster, engine, surface)
  const primaryKey = cluster.processDefinitionKeys.find((k) => k !== UNKNOWN)
  const name = cluster.activityName ?? cluster.activityId
  // Drill keeps the cluster scope (activity + type + message signature), not a list that loses the root-cause filter.
  const drill = () =>
    go({
      type: "cluster-detail",
      activityId: cluster.activityId,
      incidentType: cluster.incidentType,
      messageSignature: cluster.messageSignature,
      label: cluster.activityName ?? undefined,
    })

  const scope =
    cluster.processDefinitionKeys.length > 1
      ? t("engineHealth.scopeProcesses", {
          count: formatNumber(cluster.processDefinitionKeys.length),
        })
      : (cluster.processDefinitionName ?? primaryKey ?? UNKNOWN)
  const facts = [
    t("engineHealth.clusterAffected", {
      count: formatCountAtLeast(cluster.incidentCount, cluster.scannedIncidentCount),
    }),
    cluster.last24hCount !== null && cluster.last24hCount > 0
      ? t("engineHealth.clusterNew24h", { count: formatNumber(cluster.last24hCount) })
      : null,
    scope,
  ].filter((part): part is string => part !== null)

  return (
    <li className="border-border flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <NamedId name={cluster.activityName} id={cluster.activityId} />
          <span className="border-input text-muted-foreground text-small rounded-sm border px-1.5 font-mono">
            {cluster.incidentType}
          </span>
        </div>
        {cluster.representativeMessage && (
          <p className="text-foreground text-dense line-clamp-2 break-words">
            <span className="sr-only">{t("engineHealth.clusterCause")} </span>
            {cluster.representativeMessage}
          </p>
        )}
        <p className="text-muted-foreground text-small">{facts.join(" · ")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DrillButton
          onDrill={drill}
          ariaLabel={t("engineHealth.clusterViewAria", { activity: name })}
        >
          {t("engineHealth.clusterOpen")}
        </DrillButton>
        <HandOffButton action={canFix ? "planFix" : "explainError"} prompt={ask(handOff)} />
      </div>
    </li>
  )
}

function HealthUnavailable({
  engine,
  loading,
  error,
  onRetry,
}: {
  engine?: string
  loading: boolean
  error: Error | null
  onRetry: () => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <div className="flex flex-col items-start gap-3">
      <ViewDataState
        loading={loading}
        error={error}
        onRetry={onRetry}
        loadingText={t("engineHealth.loading")}
        emptyText={t("engineHealth.noData")}
        className="w-full"
      />
      {/* An unreachable engine is a failure to understand too: the chat can
          look for the cause while the operator retries. */}
      {error && (
        <HandOffButton action="findCause" prompt={ask(diagnoseHandOff(engine, error.message))} />
      )}
    </div>
  )
}

/** Only open incidents carry a state; the other KPIs are neutral counts (#322 U14). */
function HealthKpis({ summary, go }: { summary: EngineHealthData["summary"]; go: OnNavigate }) {
  const t = useT()
  return (
    <KpiGrid
      boxed
      ariaLabel={t("engineHealth.kpiHealth")}
      cells={[
        {
          label: t("engineHealth.kpiRunningInstances"),
          value: formatNumber(summary.runningInstances),
          // The KPI counts instances, so the drill lands on instances, not definitions.
          onClick: () => go({ type: "process-instances" }),
          // Named by its visible label and value (WCAG 2.5.3); the hint
          // says what the click does.
          actionHint: t("engineHealth.kpiRunningInstancesAria"),
        },
        {
          label: t("engineHealth.kpiOpenIncidents"),
          // The derivative beats the absolute during an active incident:
          // "9 in the last hour" = burning now; fall back to the 24h count.
          value: formatNumber(summary.totalIncidents),
          fraction:
            summary.lastHourIncidents > 0
              ? ` ${t("engineHealth.kpiInLastHour", { count: formatNumber(summary.lastHourIncidents) })}`
              : summary.last24hIncidents > 0
                ? ` ${t("engineHealth.kpiIn24h", { count: formatNumber(summary.last24hIncidents) })}`
                : undefined,
          tone: summary.totalIncidents > 0 ? "danger" : undefined,
          onClick: () => go({ type: "incidents" }),
          actionHint: t("engineHealth.kpiOpenIncidentsAria"),
        },
        {
          label: t("engineHealth.kpiAffectedActivities"),
          // null: the incident scan was capped — "—", never a guessed count.
          value: formatCount(summary.affectedActivities),
        },
        {
          label: t("engineHealth.kpiAffectedProcesses"),
          value: formatNumber(summary.affectedDefinitions),
          fraction: ` /${formatNumber(summary.totalDefinitions)}`,
        },
      ]}
    />
  )
}

/* Shows the engine moving work even with zero incidents; hidden when history is unavailable. */
function Throughput24h({ summary }: { summary: EngineHealthData["summary"] }) {
  const t = useT()
  if (summary.started24h === null && summary.completed24h === null) return null
  return (
    <p className="text-muted-foreground text-small">
      {t("engineHealth.throughput24h")}{" "}
      {summary.started24h !== null
        ? t("engineHealth.throughputStarted", { count: formatNumber(summary.started24h) })
        : ""}
      {summary.started24h !== null && summary.completed24h !== null ? " · " : ""}
      {summary.completed24h !== null
        ? t("engineHealth.throughputCompleted", { count: formatNumber(summary.completed24h) })
        : ""}
    </p>
  )
}

function ClustersSection({
  clusters,
  engine,
  engineId,
  go,
}: {
  clusters: EngineHealthCluster[]
  engine?: string
  engineId: string
  go: OnNavigate
}) {
  const t = useT()
  // Per instance: two engine-health views on one page keep their own label.
  const headingId = useId()
  if (clusters.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-section text-foreground">
        {t("engineHealth.clustersHeading")}
      </h2>
      <ul className="flex flex-col gap-2">
        {clusters.map((cluster) => (
          // Standalone renders pass no `engine`; never inline a placeholder as a tool-call engine id.
          <ClusterRow key={cluster.id} cluster={cluster} engine={engine ?? engineId} go={go} />
        ))}
      </ul>
    </section>
  )
}

// Two modes: standalone the data arrives via `data`; inside the cockpit only `engine` and it self-fetches.
export function EngineHealthView({
  data: initialData = null,
  engine,
}: {
  data?: EngineHealthData | null
  engine?: string
}) {
  const t = useT()
  const go = useNav()
  const { ask, context } = useHandOff()
  // Standalone data SEEDS the feed scoped to its engine, so a refresh re-reads that engine.
  // Always ready: `engine` is optional here, so gating on `!!engine` would stick on "No data".
  const feedEngine = engine ?? initialData?.engineId
  const view = useViewData<EngineHealthData>(
    initialData,
    ["camunda7:engine-health", feedEngine ?? null],
    CAMUNDA7_ENGINE_HEALTH_DATA,
    { engine: feedEngine },
    true,
    { initialDataMode: "seed" },
  )
  const { data, loading, error, refetch } = view
  const { refreshError, refreshing } = viewRefreshState(view)
  // Inside the cockpit its head holds the one Refresh (#322 U27); a
  // standalone overview keeps its own.
  const inCockpit = useEngineInChrome()

  if (!data) {
    return <HealthUnavailable engine={engine} loading={loading} error={error} onRetry={refetch} />
  }

  const badge = verdictBadge(data)
  const engineId = engine ?? data.engineId

  return (
    <>
      <HostModelContext content={context(describeHealth(data, engine))}>{null}</HostModelContext>
      <WidgetHeader
        badge={<StatusBadge tone={badge.tone}>{t(badge.labelKey)}</StatusBadge>}
        // The engine in the title (#322 U4): prod-leasing and test-leasing
        // never share a heading.
        title={t("engineHealth.titleFor", { engine: engineId })}
        sub={
          <>
            <EngineMeta engineId={engineId} asOf={data.fetchedAt} />
            <span>{healthVerdictLine(t, data)}</span>
          </>
        }
        actions={
          <>
            {/* The deterministic next step leads (#322 U11): with open
                incidents, look at them; a fresh read (standalone; the
                cockpit's bar has its own) and the chat assessment follow. */}
            {data.summary.totalIncidents > 0 && (
              <Button type="button" size="sm" onClick={() => go({ type: "incidents" })}>
                <Icon icon={TriangleAlert} />
                {t("engineHealth.openIncidents")}
              </Button>
            )}
            {!inCockpit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refetch}
                disabled={refreshing}
              >
                <Icon icon={RefreshCw} />
                {refreshing ? t("engineHealth.refreshing") : t("engineHealth.refresh")}
              </Button>
            )}
            <HandOffButton action="assess" prompt={ask(triageHandOff(data, engine))} />
          </>
        }
      />

      {/* A failed re-pull keeps the last verdict — and says it is not current. */}
      {refreshError && !refreshing && (
        <ErrorState
          variant="inline"
          tone="warning"
          title={t("engineHealth.refreshFailedTitle")}
          description={t("engineHealth.refreshFailedHint")}
          details={refreshError.message}
          onRetry={refetch}
        />
      )}

      <HealthKpis summary={data.summary} go={go} />

      <Throughput24h summary={data.summary} />

      <ClustersSection clusters={data.clusters} engine={engine} engineId={data.engineId} go={go} />
    </>
  )
}

export function EngineHealthVerdict({
  data,
  engine,
}: {
  data: EngineHealthData | null
  engine?: string
}) {
  return (
    <WidgetShell>
      <EngineHealthView data={data} engine={engine} />
    </WidgetShell>
  )
}
