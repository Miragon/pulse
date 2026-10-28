import { useDetailView } from "@miragon/pulse-widget-shell/widgets"

import type { InstanceDetailData } from "../view-models.js"
import { CAMUNDA7_INSTANCE_DETAIL_DATA } from "../tool-names.js"
import { DetailPage, type DetailPageTab } from "./detail-page.js"
import { InstanceActionDialogs } from "./instance-detail/dialogs.js"
import { InstanceDiagramSection } from "./instance-detail/diagram.js"
import { InstanceHeader, InstanceKpis, instanceStatus } from "./instance-detail/header.js"
import { HistoryTab } from "./instance-detail/history-tab.js"
import { IncidentsTab } from "./instance-detail/incidents-tab.js"
import { InstanceModelContext } from "./instance-detail/model-context.js"
import { OpenTasksTab, useOpenTasks } from "./instance-detail/open-tasks.js"
import { useInstanceActions } from "./instance-detail/use-instance-actions.js"
import { VariablesTab } from "./instance-detail/variables-tab.js"
import { useT } from "../messages/use-t.js"

export type { InstanceDetailData }

// Standalone from the data's echo, so a refetch reads the engine the show tool answered for, never the caller's default.
function instanceFeed(
  initialData: InstanceDetailData | null,
  processInstanceId: string | undefined,
  engine: string | undefined,
) {
  const instanceId = processInstanceId ?? initialData?.instance.id
  const feedEngine = engine ?? initialData?.engineId
  return {
    key: ["camunda7:instance-detail", feedEngine ?? null, instanceId ?? null],
    args: { processInstanceId: instanceId, engine: feedEngine },
    ready: !!instanceId,
  }
}

export function InstanceDetailWidget({
  data: initialData = null,
  processInstanceId,
  engine,
}: {
  data?: InstanceDetailData | null
  processInstanceId?: string
  engine?: string
}) {
  const t = useT()
  const { data, guard, notice, refreshError } = useDetailView<InstanceDetailData>({
    initialData,
    ...instanceFeed(initialData, processInstanceId, engine),
    tool: CAMUNDA7_INSTANCE_DETAIL_DATA,
    loadingText: t("instanceDetail.loading"),
    emptyText: t("instanceDetail.noData"),
    retryText: t("viewState.retry"),
  })
  const actions = useInstanceActions({ engine, data, unconfirmed: refreshError !== null })
  const { complete, visibleTasks, activeTaskId, onToggleTask, onTaskCompleted } = useOpenTasks(
    data?.openTasks,
    actions.canCompleteTasks,
  )

  if (!data) return guard

  const { instance, activityTree, variables, incidents, diagramDefinitionId } = data
  const { engineId, isSuspended, cancelled, isActionable } = actions

  const variableEntries = Object.entries(variables)
  const activeIncidents = incidents.filter((i) => !actions.recovery.isDone(i))
  // The lists are capped: exact engine totals minus what this view resolved, never a list length.
  const openIncidentCount = data.incidentCount - (incidents.length - activeIncidents.length)
  const openTaskCount = data.openTaskCount - (data.openTasks.length - visibleTasks.length)
  const status = instanceStatus(t, { cancelled, ended: instance.ended, isSuspended })

  const tabs: DetailPageTab[] = [
    {
      id: "tasks",
      label: t("instanceDetail.tabTasks"),
      count: openTaskCount,
      // In-progress task-form input must survive a tab switch.
      keepMounted: true,
      content: (
        <OpenTasksTab
          openTasks={data.openTasks}
          visibleTasks={visibleTasks}
          engineId={engineId}
          complete={complete}
          activeTaskId={activeTaskId}
          onToggleTask={onToggleTask}
          onTaskCompleted={onTaskCompleted}
        />
      ),
    },
    {
      id: "incidents",
      label: t("instanceDetail.tabIncidents"),
      count: openIncidentCount,
      content: <IncidentsTab incidents={incidents} recovery={actions.recovery} engine={engineId} />,
    },
    {
      id: "variables",
      label: t("instanceDetail.tabVariables"),
      count: variableEntries.length,
      // An open variable-edit row must survive a tab switch.
      keepMounted: true,
      content: (
        <VariablesTab
          variables={variables}
          instanceId={instance.id}
          definitionId={instance.definitionId}
          engineId={engineId}
          readOnly={!isActionable}
        />
      ),
    },
    {
      id: "history",
      label: t("instanceDetail.tabHistory"),
      content: (
        <HistoryTab
          instanceId={instance.id}
          definitionId={instance.definitionId}
          definitionKey={data.definitionKey}
          engineId={engineId}
          incidentActivityIds={data.incidentActivityIds}
        />
      ),
    },
  ]

  const defaultTab =
    visibleTasks.length > 0 ? "tasks" : activeIncidents.length > 0 ? "incidents" : "variables"

  return (
    <DetailPage
      header={
        <>
          {notice}
          <InstanceHeader
            instance={instance}
            processName={data.processDefinitionName}
            status={status}
            engineId={engineId}
            activeActivityIds={data.activeActivityIds}
            incidentActivityIds={data.incidentActivityIds}
            isSuspended={isSuspended}
            isActionable={isActionable}
            isMutatingInstance={actions.isMutatingInstance}
            onRequestSuspendToggle={actions.canSuspend ? actions.requestSuspendToggle : undefined}
            onRequestCancel={actions.canCancel ? actions.requestCancel : undefined}
          />
        </>
      }
      kpi={
        <InstanceKpis
          status={status}
          openTaskCount={openTaskCount}
          openIncidentCount={openIncidentCount}
          variableCount={variableEntries.length}
        />
      }
      diagram={
        <InstanceDiagramSection
          diagramDefinitionId={diagramDefinitionId}
          engineId={engineId}
          activityTree={activityTree}
          activeActivityIds={data.activeActivityIds}
          incidentActivityIds={data.incidentActivityIds}
          visibleTasks={visibleTasks}
        />
      }
      tabs={tabs}
      defaultTab={defaultTab}
    >
      <InstanceModelContext
        instance={instance}
        engineId={engineId}
        cancelled={cancelled}
        unconfirmed={refreshError !== null}
        isSuspended={isSuspended}
        openIncidentCount={openIncidentCount}
      />
      <InstanceActionDialogs actions={actions} />
    </DetailPage>
  )
}
