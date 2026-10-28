import {
  HandOffButton,
  OpenInCockpitLink,
  ViewDataState,
  WidgetShell,
  formatNumber,
  formatTimestamp,
} from "@miragon/pulse-widget-shell/widgets"
import { StatusBadge, WidgetHeader, DrillButton } from "@miragon/mcp-toolkit-ui"
import type { ProcessIncidentsData } from "../../view-models.js"
import { useNav } from "../navigation.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { EngineMeta } from "../lib/engine-context.js"
import { useT } from "../../messages/use-t.js"
import { diagramActivityFraction } from "./activity-scope.js"
import { useDefinitionData } from "./feed.js"

/** The definition's name is the deployer's text: quoted. */
export function triageProcessHandOff(
  data: ProcessIncidentsData,
  engine: string | undefined,
): HandOff {
  const fraction = diagramActivityFraction(data)
  return {
    intent: "askAi.process.triage",
    ids: { engine, processDefinitionKey: data.processDefinitionKey, noRetriesLeft: true },
    // Counts span all versions; only the diagram is one version (#335 N60).
    facts: {
      countScope: "allVersions",
      diagramVersion: data.diagramVersion,
      openIncidents: data.incidentCount,
      failedJobs: data.failedJobs,
      runningInstances: data.runningInstances,
      problemActivities: data.activities.map((a) => a.activityId),
      affectedDiagramActivities: fraction?.affected,
      diagramActivities: fraction?.total,
      affectedOnlyInOlderVersions: fraction?.olderVersionsOnly || undefined,
    },
    untrusted: [{ label: "processName", text: data.processDefinitionName }],
    tools: [
      "camunda7_list_incidents",
      "camunda7_list_jobs",
      "camunda7_get_job_stacktrace",
      "camunda7_query_historic_incidents",
      "camunda7_query_historic_activity_instances",
    ],
  }
}

/** Healthy definitions render too; the badge shows only when something is on fire. */
function HeaderBadge({ data }: { data: ProcessIncidentsData }) {
  const t = useT()
  if (data.incidentCount === 0) return null
  return (
    <StatusBadge tone="danger">
      {t("procIncHeader.openIncidents", { count: formatNumber(data.incidentCount) })}
    </StatusBadge>
  )
}

function HeaderSub({ data, engine }: { data: ProcessIncidentsData; engine?: string }) {
  const t = useT()
  return (
    <>
      <EngineMeta engineId={engine ?? data.engineId} />
      <span className="font-mono">{data.processDefinitionKey}</span>
      <span className="text-muted-foreground">·</span>
      <span>{t("procIncHeader.allVersions")}</span>
      <span className="text-muted-foreground">·</span>
      <span>
        {t("procIncHeader.runningInstances", { count: formatNumber(data.runningInstances) })}
      </span>
      {data.latestIncident && (
        <>
          <span className="text-muted-foreground">·</span>
          <span>
            {t("procIncHeader.lastEvent", {
              time: formatTimestamp(data.latestIncident),
            })}
          </span>
        </>
      )}
    </>
  )
}

/** The view's single action home: deterministic first, then the web app, then the chat. */
export function ProcessDetailHeader({
  data: initialData = null,
  processDefinitionKey,
  engine,
}: {
  data?: ProcessIncidentsData | null
  processDefinitionKey?: string
  engine?: string
}) {
  const t = useT()
  const go = useNav()
  const { ask } = useHandOff()
  const { data, loading, error, refetch } = useDefinitionData(
    initialData,
    processDefinitionKey,
    engine,
  )

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          loadingText={t("procIncHeader.loading")}
          emptyText={t("procIncHeader.noData")}
          onRetry={refetch}
          retryLabel={t("viewState.retry")}
        />
      </WidgetShell>
    )
  }

  const title = data.processDefinitionName ?? data.processDefinitionKey

  return (
    <WidgetShell>
      <WidgetHeader
        size="detail"
        badge={<HeaderBadge data={data} />}
        title={title}
        sub={<HeaderSub data={data} engine={engine} />}
        actions={
          <>
            <DrillButton
              onDrill={() =>
                go({ type: "process-instances", processDefinitionKey: data.processDefinitionKey })
              }
            >
              {t("procIncHeader.viewRunningInstances")}
            </DrillButton>
            {data.cockpitUrl && (
              <OpenInCockpitLink url={data.cockpitUrl} vendor={data.engineVendor} />
            )}
            <HandOffButton
              action="assess"
              prompt={ask(triageProcessHandOff(data, engine ?? data.engineId))}
            />
          </>
        }
      />
    </WidgetShell>
  )
}
