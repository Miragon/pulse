/**
 * What `engine_complete_task` reports: the tool returns it and the task form's widgets read it,
 * so both sides share this one type. A delegated task is resolved back to its owner, not
 * completed.
 */
export type TaskCompletion =
  | { success: true; taskId: string; outcome: "completed" }
  /** A delegated task went back to its owner (now its assignee) and stays open. */
  | { success: true; taskId: string; outcome: "resolved"; assignee: string | null }
