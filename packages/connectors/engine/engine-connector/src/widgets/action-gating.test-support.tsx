import { createElement, type ComponentType, type ReactElement } from "react"

import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type {
  IncidentInstance,
  IncidentRecovery,
  InstanceDetailData,
  JobPanelData,
} from "../view-models.js"
import type { GatingSite } from "./action-gating.sites.js"
import { InstanceDetailWidget } from "./instance-detail.js"
import { VariablesTable } from "./instance-sections.js"
import { JobPanelWidget } from "./job-panel.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"
import { TestViewHost, type QueryClient } from "@miragon/pulse-widget-shell/widgets"

/** `client` is the test's, so it can wait for the gate feed to settle. */
type Renderer = (allowedActions: readonly string[], client: QueryClient) => ReactElement

function host(
  widget: ComponentType<Record<string, unknown>>,
  allowedActions: readonly string[],
  client: QueryClient,
  data?: unknown,
): ReactElement {
  return (
    <TestViewHost
      tools={{
        [ENGINE_WIDGET_ACTIONS_DATA]: { allowedActions: [...allowedActions] },
      }}
      client={client}
    >
      {createElement(widget, data === undefined ? {} : { data })}
    </TestViewHost>
  )
}

const INSTANCE: InstanceDetailData = {
  instance: {
    id: "pi-1",
    definitionId: "invoice:1:abc",
    businessKey: "INV-7",
    suspended: false,
    ended: false,
  },
  processDefinitionName: null,
  definitionKey: "invoice",
  activityTree: null,
  variables: {},
  incidents: [],
  incidentCount: 0,
  diagramDefinitionId: null,
  activeActivityIds: ["review"],
  incidentActivityIds: [],
  openTasks: [
    {
      id: "review",
      name: "Review invoice",
      assignee: null,
      created: "2026-10-10T08:00:00.000+0000",
      due: null,
      priority: 50,
      processDefinitionId: "invoice:1:abc",
      processInstanceId: "pi-1",
      taskDefinitionKey: "review",
      description: null,
      formSchema: { taskId: "review", fields: [] },
    },
  ],
  openTaskCount: 1,
  engineId: "prod",
}

const JOBS: JobPanelData = {
  totalCount: 1,
  failedCount: 1,
  jobs: [
    {
      id: "job-1",
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
      processDefinitionId: "invoice:1:abc",
      processDefinitionName: null,
      activityId: "chargeCard",
      activityName: null,
      retries: 0,
      exceptionMessage: "Card declined",
      dueDate: null,
      suspended: false,
      priority: 0,
      createTime: "2026-06-11T08:00:00.000Z",
    },
  ],
  filters: {},
  engineId: "prod",
}

/** One incident row whose remedy is `recovery`. */
function incidentRows(incidentType: string, recovery: IncidentRecovery) {
  const rows: IncidentInstance[] = [
    {
      id: "inc-1",
      processInstanceId: "pi-1",
      incidentType,
      incidentMessage: "boom",
      incidentTimestamp: "2026-10-10T08:00:00.000+0000",
      activityId: "charge",
      activityName: null,
      cockpitInstanceUrl: null,
      businessKey: null,
      recovery,
    },
  ]
  const Rows: ComponentType<Record<string, unknown>> = () => {
    const recoveryState = useIncidentRecovery("prod", { resetOn: rows })
    return <IncidentTable incidents={rows} recovery={recoveryState} onAnalyze={() => {}} />
  }
  return Rows
}

/** The instance and jobs routes on the fixtures' engine. */
const Instance: ComponentType<Record<string, unknown>> = ({ data }) => (
  <InstanceDetailWidget data={data as InstanceDetailData} processInstanceId="pi-1" engine="prod" />
)
const Jobs: ComponentType<Record<string, unknown>> = ({ data }) => (
  <JobPanelWidget data={data as JobPanelData} engine="prod" />
)
const Variables: ComponentType<Record<string, unknown>> = () => (
  <VariablesTable variables={{ amount: { value: 42, type: "Integer" } }} instanceId="pi-1" />
)

/** Render-level half of the write guard (#341): keyed exhaustively, so a site without a surface does not compile. */
export const GATING_RENDERERS: Record<GatingSite, Renderer> = {
  "job-panel.tsx#engine_set_job_retries": (allowed, client) => host(Jobs, allowed, client, JOBS),
  "instance-sections.tsx#engine_set_process_instance_variable": (allowed, client) =>
    host(Variables, allowed, client),
  "instance-detail/open-tasks.tsx#engine_complete_task": (allowed, client) =>
    host(Instance, allowed, client, INSTANCE),
  "instance-detail/use-instance-actions.ts#engine_set_process_instance_suspension": (
    allowed,
    client,
  ) => host(Instance, allowed, client, INSTANCE),
  "instance-detail/use-instance-actions.ts#engine_delete_process_instance": (allowed, client) =>
    host(Instance, allowed, client, INSTANCE),
  "process-incidents/use-incident-recovery.ts#engine_resolve_incident": (allowed, client) =>
    host(incidentRows("invoiceMismatch", { action: "resolve" }), allowed, client),
  "process-incidents/use-incident-recovery.ts#engine_set_job_retries": (allowed, client) =>
    host(incidentRows("failedJob", { action: "retry-job", jobId: "job-1" }), allowed, client),
  "process-incidents/use-incident-recovery.ts#engine_set_external_task_retries": (
    allowed,
    client,
  ) =>
    host(
      incidentRows("failedExternalTask", {
        action: "retry-external-task",
        externalTaskId: "ext-1",
      }),
      allowed,
      client,
    ),
}
