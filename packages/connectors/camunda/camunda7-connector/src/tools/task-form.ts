import { readTaskVariables, type Client, type VariableMap } from "@miragon/pulse-camunda7-client"
import type { TaskFormField, TaskFormSchema } from "../view-models.js"
import { getTaskFormInput } from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { getTask } from "@miragon/pulse-camunda7-client/sdk"
import { fetchDefinitionXml } from "../lib/definition-xml.js"
import { extractEmbeddedFormFields } from "../lib/bpmn-task-form.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

interface TaskMeta {
  taskDefinitionKey?: string | null
  processDefinitionId?: string | null
  /** The task's own form (embedded/external/`camunda-forms:`), if any. */
  formKey?: string | null
  /** A linked Camunda Form (`camunda:formRef`) — the task then has no formKey. */
  camundaFormRef?: { key?: string | null } | null
}

export interface BuildTaskFormSchemaOptions {
  task?: TaskMeta | null
  /** `null` skips the BPMN fetch; `undefined` fetches on demand. */
  bpmnXml?: string | null
}

export function registerTaskFormTools(register: Register) {
  register({
    name: "camunda7_get_task_form",
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

/** Task and BPMN lookups throw instead of reading as "no form", which would let a caller skip the form. */
export async function buildTaskFormSchema(
  client: Client,
  taskId: string,
  options: BuildTaskFormSchemaOptions = {},
): Promise<TaskFormSchema> {
  const taskMeta: TaskMeta = options.task ?? (await getTask({ client, path: { id: taskId } }))
  const taskDefinitionKey = taskMeta.taskDefinitionKey ?? null
  const ownForm = ownFormOf(taskMeta)

  const bpmnXml =
    "bpmnXml" in options
      ? (options.bpmnXml ?? null)
      : await fetchBpmnXml(client, taskMeta.processDefinitionId ?? null)

  const fields =
    bpmnXml && taskDefinitionKey ? extractEmbeddedFormFields(bpmnXml, taskDefinitionKey) : []
  if (fields.length === 0) return { taskId, fields: [], ...ownForm }

  // Optional: a failed read leaves the fields empty.
  const currentVars = await readTaskVariables(client, taskId).catch((): VariableMap => ({}))
  const filledFields: TaskFormField[] = fields.map((field) => {
    const varEntry = currentVars[field.name]
    if (varEntry !== undefined && field.defaultValue === undefined) {
      return { ...field, defaultValue: varEntry.value }
    }
    return field
  })

  return { taskId, fields: filledFields }
}

/** The engine validates neither form on submit, so empty fields must not read as "no form". */
function ownFormOf(task: TaskMeta): Pick<TaskFormSchema, "formKey" | "formRef"> {
  if (task.formKey) return { formKey: task.formKey }
  const formRef = task.camundaFormRef?.key
  return formRef ? { formRef } : {}
}

async function fetchBpmnXml(
  client: Client,
  processDefinitionId: string | null,
): Promise<string | null> {
  if (!processDefinitionId) return null
  return fetchDefinitionXml(client, processDefinitionId)
}
