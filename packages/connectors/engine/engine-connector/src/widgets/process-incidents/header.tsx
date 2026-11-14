import {
  Button,
  formatNumber,
  formatTimestamp,
  Icon,
  StateLabel,
  WidgetHeader,
} from "@miragon/pulse-ui"
import {
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
      openIncidents: data.incidentCount,
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
 * Healthy definitions render too; the state shows only when something is on fire. A count in the
 * header is a state label, never a tinted badge (invariant 6): the incident's icon carries the
 * tone, the number stays in the foreground.
 */
function HeaderBadge({ data }: { data: ProcessIncidentsData }) {
  const t = useT()
  if (data.incidentCount === 0) return null
  return (
    <StateLabel state="incident">
      {t("procIncHeader.openIncidents", { count: formatNumber(data.incidentCount) })}
    </StateLabel>
  )
}

function HeaderSub({ data }: { data: ProcessIncidentsData }) {
  const t = useT()
  return (
    <>
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
export function ProcessDetailHeader(scope: DefinitionScope) {
  const t = useT()
  const go = useNav()
  const { ask } = useHandOff()
  const { data, loading, error, refetch } = useDefinitionData(scope)

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

  // The route's bar alone: the KPIs, the flow and the list below are views of their own.
  return (
    <WidgetShell
      header={
        <WidgetHeader
          badge={<HeaderBadge data={data} />}
          title={title}
          sub={<HeaderSub data={data} />}
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
