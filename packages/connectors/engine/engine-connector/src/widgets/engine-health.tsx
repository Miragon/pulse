import {
  FreshnessStamp,
  Button,
  StatusBadge,
  StatusStrip,
  WidgetHeader,
  type ToneVariant,
  Icon,
} from "@miragon/pulse-ui"
import {
  HandOffButton,
  isPermanentError,
  isSessionEnded,
  ViewDataState,
  WidgetShell,
  viewRefreshState,
  HostModelContext,
  useQueryClient,
  useViewData,
  type ViewDataResult,
} from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw, TriangleAlert } from "lucide-react"
import type { EngineHealthData, EngineHealthStatus } from "../view-models.js"
import { useNav, type OnNavigate } from "./navigation.js"
import { ENGINE_HEALTH_DATA } from "../tool-names.js"
import { useHandOff, useHandOffsShown, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { healthFailureOf, VERDICT_TONE } from "./lib/health-verdict.js"
import { ClustersSection } from "./engine-health-clusters.js"
import { HealthKpis, Throughput24h } from "./engine-health-kpis.js"
import { useT } from "../messages/use-t.js"
import { refreshCockpitData } from "./refresh.js"

const STATUS_LABEL: Record<EngineHealthStatus, string> = {
  ok: "engineHealth.statusStable",
  warning: "engineHealth.statusWarning",
  critical: "engineHealth.statusCritical",
}

/**
 * An ok engine with nothing deployed is neutral, never a green check over an empty engine (#322
 * U14); one the verdict judges degraded or critical (a root incident outside any process: a
 * batch's, the history cleanup's) shows its verdict, as the web app's badge does, so one engine
 * never shows two states.
 */
function verdictBadge(data: EngineHealthData): { tone: ToneVariant; labelKey: string } {
  const empty = data.summary.totalDefinitions === 0 && data.summary.totalIncidents === 0
  if (data.status === "ok" && empty) {
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
      openRootIncidents: summary.totalIncidents,
      rootIncidentsLastHour: summary.lastHourIncidents,
      affectedActivities: summary.affectedActivities,
      affectedDefinitions: summary.affectedDefinitions,
      runningInstances: summary.runningInstances,
      started24h: summary.started24h,
      completed24h: summary.completed24h,
      historyRecorded: summary.historyRecorded,
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
      openRootIncidents: summary.totalIncidents,
      rootIncidentsLastHour: summary.lastHourIncidents,
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

/**
 * The deterministic next step leads (#322 U11): with open incidents, look at them; the chat
 * assessment follows. The cockpit's head holds the one Refresh (#322 U27).
 */
function HealthActions({
  data,
  engine,
  go,
}: {
  data: EngineHealthData
  engine: string
  go: OnNavigate
}) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <>
      {data.summary.totalIncidents > 0 && (
        <Button type="button" variant="toolbar" size="sm" onClick={() => go({ type: "incidents" })}>
          <Icon icon={TriangleAlert} />
          {t("engineHealth.openIncidents")}
        </Button>
      )}
      <HandOffButton action="assess" variant="toolbar" prompt={ask(triageHandOff(data, engine))} />
    </>
  )
}

/**
 * A failed re-pull keeps the last verdict and says it is not current, docked under the bar, the
 * engine's own text under its Details; a refusal no retry changes offers no retry. A page's ended
 * session is the page frame's to say, once.
 */
function RefreshFailedStrip({ view }: { view: ViewDataResult<EngineHealthData> }) {
  const t = useT()
  const { refreshError, refreshing } = viewRefreshState(view)
  if (!refreshError || refreshing || isSessionEnded(refreshError)) return null
  const retry = { label: t("viewState.retry"), icon: RefreshCw, onClick: () => void view.refetch() }
  return (
    <StatusStrip
      tone="warning"
      title={t("engineHealth.refreshFailedTitle")}
      detail={t("engineHealth.refreshFailedHint")}
      details={refreshError.message}
      actions={isPermanentError(refreshError) ? [] : [retry]}
    />
  )
}

/** The view's bar: the engine in its title, the verdict, when the numbers were read, the actions. */
function HealthBar({
  data,
  engine,
  title,
  view,
  go,
}: {
  data: EngineHealthData
  engine: string
  title: string
  view: ViewDataResult<EngineHealthData>
  go: OnNavigate
}) {
  const t = useT()
  const handOffs = useHandOffsShown()
  const badge = verdictBadge(data)
  // No open incident to look at and a hand-off the host hides: the bar has no action group.
  const hasActions = data.summary.totalIncidents > 0 || handOffs
  return (
    <>
      <WidgetHeader
        badge={<StatusBadge tone={badge.tone}>{t(badge.labelKey)}</StatusBadge>}
        // The engine in the title (#322 U4): prod-leasing and test-leasing
        // never share a heading.
        title={title}
        // The KPIs under the bar hold the counts (one home per number): the bar keeps the
        // title, the verdict and when the numbers were read.
        freshness={<FreshnessStamp at={data.fetchedAt} />}
        actions={hasActions && <HealthActions data={data} engine={engine} go={go} />}
      />
      <RefreshFailedStrip view={view} />
    </>
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
  const { context } = useHandOff()
  // Start data SEEDS the feed scoped to its engine, so a refresh re-reads that engine.
  const view = useViewData<EngineHealthData>(
    initialData,
    ["engine:health", engine],
    ENGINE_HEALTH_DATA,
    { engine },
    true,
  )
  const { data } = view

  const title = t("engineHealth.titleFor", { engine })
  if (!data) {
    // Loading or failed, the route keeps its title, the page's one heading.
    return (
      <WidgetShell header={<WidgetHeader title={title} />}>
        <HealthUnavailable engine={engine} loading={view.loading} error={view.error} />
      </WidgetShell>
    )
  }

  return (
    <WidgetShell
      header={<HealthBar data={data} engine={engine} title={title} view={view} go={go} />}
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
