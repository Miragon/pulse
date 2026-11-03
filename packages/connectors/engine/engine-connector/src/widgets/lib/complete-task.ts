import type { TaskCompletion } from "../../lib/shared/task-completion.js"
import type { EngineAction } from "./engine-action.js"

export interface CompleteTaskArgs extends Record<string, unknown> {
  taskId: string
  variables: Record<string, { value: unknown; type?: string }>
  engine?: string
}

/** Owned by the task list (`useOpenTasks`). */
export type CompleteTaskAction = EngineAction<CompleteTaskArgs, TaskCompletion>
