import { Button, formatInstant, formatRelativeTime, Icon, WidgetHeader } from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  HandOffButton,
  OpenInCockpitLink,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { CircleDot } from "lucide-react"
import type { ProcessIncidentsData } from "../../view-models.js"
import { useNav } from "../navigation.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useT } from "../../messages/use-t.js"
import { diagramActivityFraction } from "./activity-scope.js"
import { useDefinitionData, type DefinitionScope } from "./feed.js"

/** The definition's name is the deployer's text: quoted. */
export function triageProcessHandOff(
  data: ProcessIncidentsData,
  engine: string | undefined,
): HandOff {
  const fraction = diagramActivityFraction(data)
  return {
    intent: "askAi.process.triage",
    ids: { engine, processDefinitionKey: data.processDefinitionKey },
    // Counts span all versions; only the diagram is one version (#335 N60).
    facts: {
      countScope: "allVersions",
      diagramVersion: data.diagramVersion,
      openRootIncidents: data.incidentCount,
      failedJobs: data.failedJobs,
      runningInstances: data.runningInstances,
      problemActivities: data.activities.map((a) => a.activityId),
      affectedDiagramActivities: fraction?.affected,
      diagramActivities: fraction?.total,
      affectedOnlyInOlderVersions: fraction?.olderVersionsOnly || undefined,
    },
    untrusted: [{ label: "processName", text: data.processDefinitionName }],
  }
}

/**
 * The bar's facts say what no tile under it says (one home per number): the key, the version
 * scope of every count on the view, named once here, and when the last incident came in, as a
 * time ago with its instant in the title. The counts and their alarm are the KPI tiles'.
 */
function HeaderSub({ data }: { data: ProcessIncidentsData }) {
  const t = useT()
  return (
    <>
      <span className="font-mono">{data.processDefinitionKey}</span>
      <span className="text-muted-foreground">·</span>
      <span>{t("procIncHeader.allVersions")}</span>
      {data.latestIncident && (
        <>
          <span className="text-muted-foreground">·</span>
          <time dateTime={data.latestIncident} title={formatInstant(data.latestIncident)}>
            {t("procIncHeader.lastEvent", { time: formatRelativeTime(data.latestIncident) })}
          </time>
        </>
      )}
    </>
  )
}

/**
 * The view's single action home: deterministic first, then the web app, then the chat. Loading or
 * failed, it keeps the route's `title` (the process's name where the route had it, else its key).
 */
export function ProcessDetailHeader({
  title: routeTitle,
  ...scope
}: DefinitionScope & { title?: string }) {
  const t = useT()
  const go = useNav()
  const { ask } = useHandOff()
  const { data, loading, error, refetch } = useDefinitionData(scope)

  if (!data) {
    return (
      <WidgetShell header={<WidgetHeader title={routeTitle ?? scope.processDefinitionKey} />}>
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

  // The route's bar alone: the KPIs, the flow and the list below are views of their own.
  return (
    <WidgetShell
      header={
        <WidgetHeader
          title={title}
          sub={<HeaderSub data={data} />}
          freshness={<FreshnessStamp at={data.fetchedAt} />}
          actions={
            <>
              <Button
                type="button"
                variant="toolbar"
                size="sm"
                onClick={() =>
                  go({ type: "process-instances", processDefinitionKey: data.processDefinitionKey })
                }
              >
                <Icon icon={CircleDot} />
                {t("procIncHeader.viewRunningInstances")}
              </Button>
              {data.cockpitUrl && (
                <OpenInCockpitLink
                  url={data.cockpitUrl}
                  vendor={data.engineVendor}
                  variant="toolbar"
                />
              )}
              <HandOffButton
                action="assess"
                variant="toolbar"
                prompt={ask(triageProcessHandOff(data, scope.engine))}
              />
            </>
          }
        />
      }
    />
  )
}
