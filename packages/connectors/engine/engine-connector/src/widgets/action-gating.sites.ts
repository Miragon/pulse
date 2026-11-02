import type { EngineWidgetAction } from "../tool-names.js"

/** Every `useEngineAction` call site; `src/widget-actions.test.ts` holds this list EQUAL to the sources. */
export const GATING_SITES = [
  {
    site: "job-panel.tsx#engine_set_job_retries",
    write: "engine_set_job_retries",
    control: "Retry job",
  },
  {
    site: "instance-sections.tsx#engine_set_process_instance_variable",
    write: "engine_set_process_instance_variable",
    control: "Edit",
  },
  {
    site: "instance-detail/open-tasks.tsx#engine_complete_task",
    write: "engine_complete_task",
    control: "Complete",
  },
  {
    site: "instance-detail/use-instance-actions.ts#engine_set_process_instance_suspension",
    write: "engine_set_process_instance_suspension",
    control: "Suspend",
  },
  {
    site: "instance-detail/use-instance-actions.ts#engine_delete_process_instance",
    write: "engine_delete_process_instance",
    control: "Cancel instance",
  },
  {
    site: "process-incidents/use-incident-recovery.ts#engine_resolve_incident",
    write: "engine_resolve_incident",
    control: "Mark as resolved",
  },
  {
    site: "process-incidents/use-incident-recovery.ts#engine_set_job_retries",
    write: "engine_set_job_retries",
    control: "Retry",
  },
  {
    site: "process-incidents/use-incident-recovery.ts#engine_set_external_task_retries",
    write: "engine_set_external_task_retries",
    control: "Retry",
  },
] as const satisfies ReadonlyArray<{ site: string; write: EngineWidgetAction; control: string }>

export type GatingSite = (typeof GATING_SITES)[number]["site"]
