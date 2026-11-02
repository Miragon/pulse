import type { EngineWidgetAction } from "../../tool-names.js"

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
  "engine:process-incidents",
  "engine:activity-incidents",
  "engine:incidents",
  "engine:cluster-detail",
  "engine:health",
  "engine:jobs",
  "engine:instance-detail",
  "engine:process-instances",
  "engine:cockpit-overview",
] as const

const INSTANCE_LISTS = ["engine:process-instances", "engine:cockpit-overview"] as const

function views(...namespaces: string[]): readonly string[] {
  return [...new Set(namespaces)]
}

/** A property of the write, never of its button, so two surfaces running the same tool agree. */
export const WRITE_POLICY: Record<EngineWidgetAction, WritePolicy> = {
  engine_set_job_retries: { invalidates: INCIDENT_VIEWS, confirm: false },
  engine_set_external_task_retries: { invalidates: INCIDENT_VIEWS, confirm: false },
  engine_resolve_incident: { invalidates: INCIDENT_VIEWS, confirm: true },
  // Includes the jobs the next activities create and, after the last task, every running count.
  engine_complete_task: {
    invalidates: views(
      "engine:instance-detail",
      "engine:incident-detail",
      "engine:instance-history",
      "engine:history-timeline",
      "engine:jobs",
      "engine:process-incidents",
      "engine:health",
      ...INSTANCE_LISTS,
    ),
    confirm: false,
  },
  engine_set_process_instance_variable: {
    invalidates: [
      "engine:instance-detail",
      "engine:incident-detail",
      "engine:instance-history",
      "engine:history-timeline",
    ],
    confirm: false,
  },
  engine_set_process_instance_suspension: {
    invalidates: views("engine:instance-detail", "engine:jobs", ...INSTANCE_LISTS),
    confirm: true,
  },
  // The instance is gone; its detail view keeps the cancelled state.
  engine_delete_process_instance: {
    invalidates: views(
      ...INSTANCE_LISTS,
      ...INCIDENT_VIEWS.filter((key) => key !== "engine:instance-detail"),
    ),
    confirm: true,
  },
}
