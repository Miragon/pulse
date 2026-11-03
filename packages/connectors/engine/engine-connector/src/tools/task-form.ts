import type { TaskFormSchema } from "../view-models.js"
import { getTaskFormInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { buildTaskFormSchema } from "../lib/bpmn/task-form-schema.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"

export function registerTaskFormTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_get_task_form",
    category: "tasks",
    description:
      "Load the form schema for a user task from its embedded BPMN form definition (`<camunda:formData>`): fields " +
      "(type, required, readonly) pre-filled with current values. Never submit readonly fields. Without form fields, " +
      "fields is empty and formKey (or formRef, a linked Camunda Form) names the task's own form, if any.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getTaskFormInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args): Promise<TaskFormSchema> => {
      const { taskId } = args as { taskId: string }
      return buildTaskFormSchema(client, taskId)
    }),
  })
}
