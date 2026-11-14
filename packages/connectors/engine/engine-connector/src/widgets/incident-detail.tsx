import { useMemo } from "react"
import { Alert, AlertDescription, SectionHeading } from "@miragon/pulse-ui"
import { useDetailView, HostModelContext } from "@miragon/pulse-widget-shell/widgets"

import type { IncidentDetailData } from "../view-models.js"

import { ENGINE_INCIDENT_DETAIL_DATA } from "../tool-names.js"
import { BpmnDiagram, type BpmnHighlight } from "./bpmn-diagram.js"
import { DetailPage } from "./detail-page.js"
import { FailureSummary, StacktraceTab } from "./incident-detail/failure-tab.js"
import { IncidentDetailHeader } from "./incident-detail/header.js"
import { InstanceTab } from "./incident-detail/instance-tab.js"
import { EngineActionDialog } from "./lib/engine-action-dialog.js"
import {
  useIncidentRecovery,
  type IncidentRecoveryState,
  type RecoverableIncident,
} from "./process-incidents/use-incident-recovery.js"
import { scopingDefinitionKey, useHandOff, type ViewContext } from "./lib/hand-off.js"
import { PagedHistoryView } from "./history-timeline.js"
import { useT } from "../messages/use-t.js"

export type { IncidentDetailData }

// Business key included so confirmation and toasts name the instance as the head does (#322 U13).
function recoverable(data: IncidentDetailData): RecoverableIncident {
  return {
    id: data.incidentId,
    incidentType: data.incidentType,
    processInstanceId: data.processInstanceId,
    businessKey: data.businessKey,
    recovery: data.recovery,
  }
}

function remedyProps(recovery: IncidentRecoveryState, incident: RecoverableIncident) {
  const remedy = recovery.actionFor(incident)
  const act = () => recovery.act(incident)
  const pending = recovery.isPending(incident)
  const cleared = recovery.isDone(incident)
  const resolves = incident.recovery?.action === "resolve"
  return {
    resolved: cleared && resolves,
    retried: cleared && !resolves,
    onResolve: remedy === "resolve" ? act : undefined,
    resolving: remedy === "resolve" && pending,
    onRetry: remedy === "retry" ? act : undefined,
    retrying: remedy === "retry" && pending,
    retryError: remedy === "retry" ? recovery.errorOf(incident) : null,
  }
}

// The ticket draft and the remedy follow the module instructions. Engine text is quoted.
export function describeIncident(data: IncidentDetailData, resolved: boolean): ViewContext {
  // A key parsed from a bare definition id is that id, stated as what it is.
  const key = scopingDefinitionKey(data.processDefinitionKey, data.processDefinitionId)
  return {
    summary: "The operator is viewing one incident.",
    ids: {
      engine: data.engineId,
      incidentId: data.incidentId,
      processInstanceId: data.processInstanceId,
      jobId: data.job?.id,
    },
    facts: {
      incidentType: data.incidentType,
      processDefinitionKey: key,
      processDefinitionId: key ? undefined : data.processDefinitionId || undefined,
      activityId: data.activityId,
      version: data.processDefinitionVersion,
      retriesLeft: data.job?.retries,
      clearedInThisSession: resolved || undefined,
    },
    untrusted: [
      { label: "incidentMessage", text: data.incidentMessage ?? data.job?.exceptionMessage },
      { label: "activityName", text: data.activityName },
      { label: "processName", text: data.processDefinitionName },
    ],
  }
}

function IncidentModelContext({ data, resolved }: { data: IncidentDetailData; resolved: boolean }) {
  const { context } = useHandOff()
  return (
    <HostModelContext content={context(describeIncident(data, resolved))}>{null}</HostModelContext>
  )
}

export function IncidentDetailWidget({
  data: initialData = null,
  incidentId,
  engine,
}: {
  data?: IncidentDetailData | null
  incidentId: string
  engine: string
}) {
  const t = useT()
  // The route's engine: a refetch never reads the default engine.
  const { data, guard, notice, refreshError } = useDetailView<IncidentDetailData>({
    initialData,
    key: ["engine:incident-detail", engine, incidentId],
    args: { incidentId, engine },
    ready: true,
    tool: ENGINE_INCIDENT_DETAIL_DATA,
    loadingText: t("incidentDetail.loading"),
    emptyText: t("incidentDetail.noData"),
    retryText: t("viewState.retry"),
  })
  // A cleared incident's view is not refetched (404), so the marks are what it shows. A failed
  // refetch leaves it unconfirmed (cleared elsewhere?): no remedy then.
  const recovery = useIncidentRecovery(engine, {
    resetOn: data,
    available: refreshError === null,
  })

  // New highlights reimport the diagram: one array per activity, so a refetch never redraws it.
  const activityId = data?.activityId
  const highlights = useMemo<BpmnHighlight[]>(
    () => [{ kind: "incident", activityIds: activityId === undefined ? [] : [activityId] }],
    [activityId],
  )

  if (!data) return guard

  const remedy = remedyProps(recovery, recoverable(data))
  const { resolved, retried } = remedy

  // #322 U12: the failure and its remedy first, then the diagram, then the depth.
  return (
    <DetailPage
      header={<IncidentDetailHeader data={data} resolved={resolved} />}
      notice={notice}
      summary={<FailureSummary data={data} {...remedy} />}
      diagram={
        <section>
          <SectionHeading
            title={t("incidentDetail.processFlowTitle")}
            hint={t("incidentDetail.processFlowHint", {
              activity: data.activityName ?? data.activityId,
            })}
          />
          {data.diagramDefinitionId ? (
            <BpmnDiagram
              definitionId={data.diagramDefinitionId}
              engineId={engine}
              highlights={highlights}
            />
          ) : (
            <Alert>
              <AlertDescription>{t("incidentDetail.noBpmnDiagram")}</AlertDescription>
            </Alert>
          )}
        </section>
      }
      tabs={[
        {
          id: "stacktrace",
          label: t("incidentDetail.tabStacktrace"),
          content: <StacktraceTab data={data} />,
        },
        {
          id: "instance",
          label: t("incidentDetail.tabInstance"),
          content: <InstanceTab data={data} engineId={engine} />,
        },
        {
          id: "history",
          label: t("incidentDetail.tabHistory"),
          /* Mounted on first tab activation. Pages the registrar history
             query itself instead of shipping capped rows in the payload. */
          content: (
            <PagedHistoryView
              processInstanceId={data.processInstanceId}
              engine={engine}
              variant="table"
              incidentActivityIds={resolved || retried ? [] : [data.activityId]}
            />
          ),
        },
      ]}
      defaultTab="stacktrace"
    >
      {/* Described from what is on screen: in the cockpit the widget self-fetches,
          so only it knows the data. */}
      <IncidentModelContext data={data} resolved={resolved || retried} />

      <EngineActionDialog action={recovery.resolve} />
    </DetailPage>
  )
}
