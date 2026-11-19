import {
  Button,
  KpiGrid,
  StatusBadge,
  StatusStrip,
  WidgetHeader,
  type ToneVariant,
  Icon,
  formatCount,
  formatNumber,
} from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  HandOffButton,
  isPermanentError,
  isSessionEnded,
  ViewDataState,
  WidgetShell,
  viewRefreshState,
  HostModelContext,
  useQueryClient,
  useViewData,
} from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw, TriangleAlert } from "lucide-react"
import type { EngineHealthData, EngineHealthStatus } from "../view-models.js"
import { useNav, type OnNavigate } from "./navigation.js"
import { ENGINE_HEALTH_DATA } from "../tool-names.js"
import { AlarmCount } from "./lib/alarm-count.js"
import { useHandOff, useHandOffsShown, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { healthFailureOf, VERDICT_TONE } from "./lib/health-verdict.js"
import { ClustersSection } from "./engine-health-clusters.js"
import { useT } from "../messages/use-t.js"
import { refreshCockpitData } from "./refresh.js"

const STATUS_LABEL: Record<EngineHealthStatus, string> = {
  ok: "engineHealth.statusStable",
  warning: "engineHealth.statusWarning",
  critical: "engineHealth.statusCritical",
}

/** An engine with nothing deployed is neutral, never a green check over an empty engine (#322 U14). */
function verdictBadge(data: EngineHealthData): { tone: ToneVariant; labelKey: string } {
  if (data.summary.totalDefinitions === 0 && data.summary.totalIncidents === 0) {
    return { tone: "neutral", labelKey: "engineHealth.statusNothingDeployed" }
  }
  return { tone: VERDICT_TONE[data.status], labelKey: STATUS_LABEL[data.status] }
}

function clusterActivities(data: EngineHealthData): string[] {
  return data.clusters.map((c) => c.activityId)
}

/** Grounding context, so the operator never restates what they are looking at. */
function describeHealth(data: EngineHealthData, engine: string): ViewContext {
  const { summary, clusters, status } = data
  const top = clusters[0]
  return {
    summary: "The operator is viewing the engine health overview of one engine.",
    ids: { engine },
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
  }
}

function triageHandOff(data: EngineHealthData, engine: string): HandOff {
  const { summary } = data
  return {
    intent: "askAi.health.triage",
    ids: { engine },
    facts: {
      openIncidents: summary.totalIncidents,
      lastHour: summary.lastHourIncidents,
      last24h: summary.last24hIncidents,
      affectedActivities: summary.affectedActivities,
      affectedDefinitions: summary.affectedDefinitions,
      runningInstances: summary.runningInstances,
      clusterActivities: clusterActivities(data),
    },
  }
}

/**
 * A failed health read is itself an incident: hand it to the agent, asked as the landing words it,
 * so an engine that refused the server's login is never "not reachable" (F2). The error text is
 * quoted, never inlined.
 */
function diagnoseHandOff(engine: string, error: Error): HandOff {
  const failure = healthFailureOf(error)
  return {
    intent:
      failure === "unauthorized" || failure === "forbidden"
        ? "askAi.health.diagnoseLogin"
        : "askAi.health.diagnoseUnreachable",
    ids: { engine },
    untrusted: [{ label: "error", text: error.message }],
  }
}

/**
 * The verdict loading or failed. Its state stands for the overview when the definitions under it
 * failed too, so its Try again reads the overview again.
 */
function HealthUnavailable({
  engine,
  loading,
  error,
}: {
  engine: string
  loading: boolean
  error: Error | null
}) {
  const t = useT()
  const { ask } = useHandOff()
  const client = useQueryClient()
  return (
    <div className="flex flex-col items-start gap-3">
      <ViewDataState
        loading={loading}
        error={error}
        onRetry={() => void refreshCockpitData(client)}
        loadingText={t("engineHealth.loading")}
        emptyText={t("engineHealth.noData")}
        className="w-full"
      />
      {/* An unreachable engine or a refused login is a failure to understand too: the
          chat can look for the cause while the operator retries. A refused profile has
          its reason on screen, and only the operator can fix it. */}
      {error && healthFailureOf(error) !== "refused" && (
        <HandOffButton action="findCause" prompt={ask(diagnoseHandOff(engine, error))} />
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
          value: (
            <AlarmCount alarm={summary.totalIncidents > 0 && "openIncidents"}>
              {formatNumber(summary.totalIncidents)}
            </AlarmCount>
          ),
          fraction:
            summary.lastHourIncidents > 0
              ? ` ${t("engineHealth.kpiInLastHour", { count: formatNumber(summary.lastHourIncidents) })}`
              : summary.last24hIncidents > 0
                ? ` ${t("engineHealth.kpiIn24h", { count: formatNumber(summary.last24hIncidents) })}`
                : undefined,
          onClick: () => go({ type: "incidents" }),
          actionHint: t("engineHealth.kpiOpenIncidentsAria"),
        },
        {
          label: t("engineHealth.kpiAffectedActivities"),
          // null (the incident scan was capped) shows "—", never a guessed count.
          value: formatCount(summary.affectedActivities),
        },
        // The deployed count is the processes section's, never a denominator here (D12).
        {
          label: t("engineHealth.kpiAffectedProcesses"),
          value: formatNumber(summary.affectedDefinitions),
        },
      ]}
    />
  )
}

/**
 * Shows the engine moving work even with zero incidents, started then completed in the last 24 h,
 * an unread one as "—"; hidden when history is unavailable.
 */
function Throughput24h({ summary }: { summary: EngineHealthData["summary"] }) {
  const t = useT()
  if (summary.started24h === null && summary.completed24h === null) return null
  return (
    <p className="text-muted-foreground text-small">
      {t("engineHealth.throughput24h")}{" "}
      <span className="tabular-nums">
        {formatCount(summary.started24h)} · {formatCount(summary.completed24h)}
      </span>
    </p>
  )
}

// Seeded through `data` (the start view), else self-fetching on the cockpit's engine.
export function EngineHealthView({
  data: initialData = null,
  engine,
}: {
  data?: EngineHealthData | null
  engine: string
}) {
  const t = useT()
  const go = useNav()
  const { ask, context } = useHandOff()
  const handOffs = useHandOffsShown()
  // Start data SEEDS the feed scoped to its engine, so a refresh re-reads that engine.
  const view = useViewData<EngineHealthData>(
    initialData,
    ["engine:health", engine],
    ENGINE_HEALTH_DATA,
    { engine },
    true,
  )
  const { data, loading, error, refetch } = view
  const { refreshError, refreshing } = viewRefreshState(view)

  const title = t("engineHealth.titleFor", { engine })
  if (!data) {
    // Loading or failed, the route keeps its title, the page's one heading.
    return (
      <WidgetShell header={<WidgetHeader title={title} />}>
        <HealthUnavailable engine={engine} loading={loading} error={error} />
      </WidgetShell>
    )
  }

  const badge = verdictBadge(data)
  // No open incident to look at and a hand-off the host hides: the bar has no action group.
  const hasActions = data.summary.totalIncidents > 0 || handOffs

  return (
    <WidgetShell
      header={
        <>
          <WidgetHeader
            badge={<StatusBadge tone={badge.tone}>{t(badge.labelKey)}</StatusBadge>}
            // The engine in the title (#322 U4): prod-leasing and test-leasing
            // never share a heading.
            title={title}
            // The KPIs under the bar hold the counts (one home per number): the bar keeps the
            // title, the verdict and when the numbers were read.
            freshness={<FreshnessStamp at={data.fetchedAt} />}
            actions={
              hasActions && (
                <>
                  {/* The deterministic next step leads (#322 U11): with open incidents, look at
                      them; the chat assessment follows. The cockpit's head holds the one Refresh
                      (#322 U27). */}
                  {data.summary.totalIncidents > 0 && (
                    <Button
                      type="button"
                      variant="toolbar"
                      size="sm"
                      onClick={() => go({ type: "incidents" })}
                    >
                      <Icon icon={TriangleAlert} />
                      {t("engineHealth.openIncidents")}
                    </Button>
                  )}
                  <HandOffButton
                    action="assess"
                    variant="toolbar"
                    prompt={ask(triageHandOff(data, engine))}
                  />
                </>
              )
            }
          />
          {/* A failed re-pull keeps the last verdict and says it is not current, docked under
              the bar, the engine's own text under its Details; a refusal no retry changes offers
              no retry. A page's ended session is the page frame's to say, once. */}
          {refreshError && !refreshing && !isSessionEnded(refreshError) && (
            <StatusStrip
              tone="warning"
              title={t("engineHealth.refreshFailedTitle")}
              detail={t("engineHealth.refreshFailedHint")}
              details={refreshError.message}
              actions={
                isPermanentError(refreshError)
                  ? []
                  : [
                      {
                        label: t("viewState.retry"),
                        icon: RefreshCw,
                        onClick: () => void refetch(),
                      },
                    ]
              }
            />
          )}
        </>
      }
    >
      <HostModelContext content={context(describeHealth(data, engine))}>{null}</HostModelContext>

      <HealthKpis summary={data.summary} go={go} />

      <Throughput24h summary={data.summary} />

      <ClustersSection clusters={data.clusters} engine={engine} go={go} />
    </WidgetShell>
  )
}

/** The overview's verdict: the engine's health as a view of its own, its bar and its content. */
export function EngineHealthVerdict({
  data,
  engine,
}: {
  data: EngineHealthData | null
  engine: string
}) {
  return <EngineHealthView data={data} engine={engine} />
}
