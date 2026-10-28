import { CAMUNDA7_SAVE_SETTINGS } from "../tool-names.js"
import type { WidgetWrite } from "./lib/write-policy.js"

/** Every `useEngineAction` call site; `src/widget-actions.test.ts` holds this list EQUAL to the sources. */
export const GATING_SITES = [
  {
    site: "job-panel.tsx#camunda7_set_job_retries",
    write: "camunda7_set_job_retries",
    control: "Retry job",
  },
  {
    site: "instance-sections.tsx#camunda7_set_process_instance_variable",
    write: "camunda7_set_process_instance_variable",
    control: "Edit",
  },
  {
    site: "instance-detail/open-tasks.tsx#camunda7_complete_task",
    write: "camunda7_complete_task",
    control: "Complete",
  },
  {
    site: "instance-detail/use-instance-actions.ts#camunda7_set_process_instance_suspension",
    write: "camunda7_set_process_instance_suspension",
    control: "Suspend",
  },
  {
    site: "instance-detail/use-instance-actions.ts#camunda7_delete_process_instance",
    write: "camunda7_delete_process_instance",
    control: "Cancel instance",
  },
  {
    site: "process-incidents/use-incident-recovery.ts#camunda7_resolve_incident",
    write: "camunda7_resolve_incident",
    control: "Mark as resolved",
  },
  {
    site: "process-incidents/use-incident-recovery.ts#camunda7_set_job_retries",
    write: "camunda7_set_job_retries",
    control: "Retry",
  },
  {
    site: "process-incidents/use-incident-recovery.ts#camunda7_set_external_task_retries",
    write: "camunda7_set_external_task_retries",
    control: "Retry",
  },
  {
    // Self-gated: the view's `canSave` (toolset AND a signed-in caller).
    site: "user-profile.tsx#camunda7_save_settings",
    write: CAMUNDA7_SAVE_SETTINGS,
    control: "Save",
  },
] as const satisfies ReadonlyArray<{ site: string; write: WidgetWrite; control: string }>

export type GatingSite = (typeof GATING_SITES)[number]["site"]
