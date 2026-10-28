import type { EngineAction } from "./engine-action.js"

export interface CompleteTaskArgs extends Record<string, unknown> {
  taskId: string
  variables: Record<string, { value: unknown; type?: string }>
  engine?: string
}

/** A delegated task is resolved, not completed. */
export interface TaskCompletion {
  outcome?: "completed" | "resolved"
  /** For a resolved task: its owner, now its assignee again. */
  assignee?: string | null
}

/** Owned by the task list (`useOpenTasks`). */
export type CompleteTaskAction = EngineAction<CompleteTaskArgs, TaskCompletion>
