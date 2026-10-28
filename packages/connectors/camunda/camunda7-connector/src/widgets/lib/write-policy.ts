import type { CAMUNDA7_SAVE_SETTINGS, Camunda7WidgetAction } from "../../tool-names.js"

/** The profile save gates itself in its view (`canSave` also needs a signed-in caller). */
export type WidgetWrite = Camunda7WidgetAction | typeof CAMUNDA7_SAVE_SETTINGS

export interface WritePolicy {
  /**
   * Query-key namespaces invalidated on success. A view whose subject the write removes is
   * left out on purpose: its refetch could only answer "not found".
   */
  invalidates: readonly string[]
  /** `useEngineAction` refuses to run these without a confirmation naming the target. */
  confirm: boolean
}

/** Includes the lists' per-row incident flag (`ProcessInstanceRow.hasIncident`). */
const INCIDENT_VIEWS = [
  "camunda7:process-incidents",
  "camunda7:activity-incidents",
  "camunda7:incidents",
  "camunda7:cluster-detail",
  "camunda7:engine-health",
  "camunda7:jobs",
  "camunda7:instance-detail",
  "camunda7:process-instances",
  "camunda7:bpmn-viewer",
  "camunda7:cockpit-overview",
  "camunda7:process-list",
] as const

const INSTANCE_LISTS = [
  "camunda7:process-instances",
  "camunda7:process-list",
  "camunda7:cockpit-overview",
  "camunda7:bpmn-viewer",
] as const

function views(...namespaces: string[]): readonly string[] {
  return [...new Set(namespaces)]
}

/** A property of the write, never of its button, so two surfaces running the same tool agree. */
export const WRITE_POLICY: Record<WidgetWrite, WritePolicy> = {
  camunda7_set_job_retries: { invalidates: INCIDENT_VIEWS, confirm: false },
  camunda7_set_external_task_retries: { invalidates: INCIDENT_VIEWS, confirm: false },
  camunda7_resolve_incident: { invalidates: INCIDENT_VIEWS, confirm: true },
  // Includes the jobs the next activities create and, after the last task, every running count.
  camunda7_complete_task: {
    invalidates: views(
      "camunda7:instance-detail",
      "camunda7:incident-detail",
      "camunda7:instance-history",
      "camunda7:jobs",
      "camunda7:process-incidents",
      "camunda7:engine-health",
      ...INSTANCE_LISTS,
    ),
    confirm: false,
  },
  camunda7_set_process_instance_variable: {
    invalidates: [
      "camunda7:instance-detail",
      "camunda7:incident-detail",
      "camunda7:instance-history",
    ],
    confirm: false,
  },
  camunda7_set_process_instance_suspension: {
    invalidates: views("camunda7:instance-detail", "camunda7:jobs", ...INSTANCE_LISTS),
    confirm: true,
  },
  // The instance is gone; its detail view keeps the cancelled state.
  camunda7_delete_process_instance: {
    invalidates: views(
      ...INSTANCE_LISTS,
      ...INCIDENT_VIEWS.filter((key) => key !== "camunda7:instance-detail"),
    ),
    confirm: true,
  },
  // The language is the shell's.
  camunda7_save_settings: {
    invalidates: ["camunda7:settings", "camunda7:engines"],
    confirm: false,
  },
}
