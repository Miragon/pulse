import { useDetailView } from "@miragon/pulse-widget-shell/widgets"

import type { InstanceDetailData } from "../view-models.js"
import { ENGINE_INSTANCE_DETAIL_DATA } from "../tool-names.js"
import { DetailPage, type DetailPageTab } from "./detail-page.js"
import { InstanceActionDialogs } from "./instance-detail/dialogs.js"
import { InstanceDiagramSection } from "./instance-detail/diagram.js"
import { InstanceHeader, instanceStatus } from "./instance-detail/header.js"
import { HistoryTab } from "./instance-detail/history-tab.js"
import { IncidentsTab } from "./instance-detail/incidents-tab.js"
import { InstanceModelContext } from "./instance-detail/model-context.js"
import { useNav } from "./navigation.js"
import { OpenTasksTab, useOpenTasks } from "./instance-detail/open-tasks.js"
import { type InstanceActions, useInstanceActions } from "./instance-detail/use-instance-actions.js"
import { VariablesTab } from "./instance-detail/variables-tab.js"
import { type T, useT } from "../messages/use-t.js"

export type { InstanceDetailData }

/** The instance's view data through the route's engine, its writes and its open tasks. */
function useInstanceDetail({
  data: initialData = null,
  processInstanceId,
  engine,
  title,
}: Parameters<typeof InstanceDetailWidget>[0]) {
  const t = useT()
  // The route's engine: a refetch never reads the default engine.
  const view = useDetailView<InstanceDetailData>({
    initialData,
    key: ["engine:instance-detail", engine, processInstanceId],
    args: { processInstanceId, engine },
    ready: true,
    tool: ENGINE_INSTANCE_DETAIL_DATA,
    loadingText: t("instanceDetail.loading"),
    emptyText: t("instanceDetail.noData"),
    retryText: t("viewState.retry"),
    title,
  })
  const actions = useInstanceActions({
    engine,
    data: view.data,
    unconfirmed: view.refreshError !== null,
  })
  const tasks = useOpenTasks(view.data?.openTasks, actions.canCompleteTasks, engine)
  return { ...view, actions, tasks }
}

/** The loaded instance and what the view does with it. */
interface InstanceParts {
  data: InstanceDetailData
  actions: InstanceActions
  tasks: ReturnType<typeof useOpenTasks>
}

/** The lists are capped: exact engine totals minus what this view resolved, never a list length. */
function instanceCounts({ data, actions, tasks }: InstanceParts) {
  const activeIncidents = data.incidents.filter((i) => !actions.recovery.isDone(i)).length
  return {
    activeIncidents,
    openIncidentCount: data.incidentCount - (data.incidents.length - activeIncidents),
    openTaskCount: data.openTaskCount - (data.openTasks.length - tasks.visibleTasks.length),
  }
}

type InstanceCounts = ReturnType<typeof instanceCounts>

/** The instance's tabs: its open tasks, its incidents, its variables and its history. */
function instanceTabs(t: T, { data, actions, tasks }: InstanceParts, counts: InstanceCounts) {
  const { instance, variables } = data
  const { engineId } = actions
  const tabs: DetailPageTab[] = [
    {
      id: "tasks",
      label: t("instanceDetail.tabTasks"),
      count: counts.openTaskCount,
      // In-progress task-form input must survive a tab switch.
      keepMounted: true,
      content: <OpenTasksTab openTasks={data.openTasks} engineId={engineId} {...tasks} />,
    },
    {
      id: "incidents",
      label: t("instanceDetail.tabIncidents"),
      count: counts.openIncidentCount,
      content: (
        <IncidentsTab incidents={data.incidents} recovery={actions.recovery} engine={engineId} />
      ),
    },
    {
      id: "variables",
      label: t("instanceDetail.tabVariables"),
      count: Object.entries(variables).length,
      // An open variable-edit row must survive a tab switch.
      keepMounted: true,
      content: (
        <VariablesTab
          variables={variables}
          instanceId={instance.id}
          definitionId={instance.definitionId}
          engineId={engineId}
          readOnly={!actions.isActionable}
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
  return tabs
}

/**
 * The instance's bar: its state and open incidents, the way to its caller and its process, and its
 * writes.
 */
function InstanceBar({
  data,
  actions,
  openIncidentCount,
}: Omit<InstanceParts, "tasks"> & { openIncidentCount: number }) {
  const t = useT()
  const go = useNav()
  const { instance } = data
  const { cancelled, isSuspended } = actions
  const callerId = data.callerInstanceId
  const processKey = data.definitionKey
  return (
    <InstanceHeader
      instance={instance}
      processName={data.processDefinitionName}
      status={instanceStatus(t, { cancelled, ended: instance.ended, isSuspended })}
      openIncidentCount={openIncidentCount}
      startTime={data.startTime}
      fetchedAt={data.fetchedAt}
      callerInstanceId={callerId}
      engineId={actions.engineId}
      activeActivityIds={data.activeActivityIds}
      incidentActivityIds={data.incidentActivityIds}
      isSuspended={isSuspended}
      isActionable={actions.isActionable}
      isMutatingInstance={actions.isMutatingInstance}
      onOpenCaller={
        callerId ? () => go({ type: "instance-detail", processInstanceId: callerId }) : undefined
      }
      onOpenProcess={
        processKey
          ? () =>
              go({
                type: "process-detail",
                processDefinitionKey: processKey,
                label: data.processDefinitionName ?? undefined,
              })
          : undefined
      }
      onRequestSuspendToggle={actions.canSuspend ? actions.requestSuspendToggle : undefined}
      onRequestCancel={actions.canCancel ? actions.requestCancel : undefined}
    />
  )
}

export function InstanceDetailWidget(props: {
  data?: InstanceDetailData | null
  processInstanceId: string
  engine: string
  /** The route's title, which its bar keeps while the instance loads or fails to. */
  title?: string
}) {
  const t = useT()
  const { data, guard, notice, refreshError, actions, tasks } = useInstanceDetail(props)

  if (!data) return guard

  const { instance, activityTree, diagramDefinitionId } = data
  const { engineId } = actions
  const parts = { data, actions, tasks }
  const counts = instanceCounts(parts)
  const defaultTab =
    tasks.visibleTasks.length > 0 ? "tasks" : counts.activeIncidents > 0 ? "incidents" : "variables"

  return (
    <DetailPage
      header={
        <InstanceBar data={data} actions={actions} openIncidentCount={counts.openIncidentCount} />
      }
      notice={notice}
      // No facts block: the bar holds the state and the open incidents, the tabs count the rest.
      diagram={
        <InstanceDiagramSection
          diagramDefinitionId={diagramDefinitionId}
          engineId={engineId}
          activityTree={activityTree}
          activeActivityIds={data.activeActivityIds}
          incidentActivityIds={data.incidentActivityIds}
          visibleTasks={tasks.visibleTasks}
        />
      }
      tabs={instanceTabs(t, parts, counts)}
      defaultTab={defaultTab}
    >
      <InstanceModelContext
        instance={instance}
        engineId={engineId}
        cancelled={actions.cancelled}
        unconfirmed={refreshError !== null}
        isSuspended={actions.isSuspended}
        openIncidentCount={counts.openIncidentCount}
        callerInstanceId={data.callerInstanceId}
      />
      <InstanceActionDialogs actions={actions} />
    </DetailPage>
  )
}
