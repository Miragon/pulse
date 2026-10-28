/**
 * The one place `camunda7_complete_task` picks its endpoint (`engine-contract.test.ts` scans for it):
 * - `/submit-form` alone validates form fields, but writes BPMN defaults over omitted fields
 *   and RESOLVES a delegated task (`SubmitTaskFormCmd`).
 * - `/complete` validates nothing and completes a delegated task, skipping its owner.
 * - `/resolve` hands a delegated task back to its owner.
 * So a form task is submitted with the current value of every omitted field, a formless one
 * completes, and a delegated one is resolved and reported as such, never as completed.
 */
import {
  readTaskVariables,
  toEngineVariables,
  type Client,
  type EngineVariableInput,
  type VariableMap,
} from "@miragon/pulse-camunda7-client"
import { complete, getTask, resolve, submit } from "@miragon/pulse-camunda7-client/sdk"
import { formFieldSubmitRules, type FormFieldSubmitRule } from "./bpmn-task-form.js"
import { fetchDefinitionXml } from "./definition-xml.js"

export type TaskCompletion =
  | { success: true; taskId: string; outcome: "completed" }
  /** A delegated task went back to its owner (now its assignee) and stays open. */
  | { success: true; taskId: string; outcome: "resolved"; assignee: string | null }

interface TaskRow {
  taskDefinitionKey?: string | null
  processDefinitionId?: string | null
  delegationState?: string | null
  owner?: string | null
}

/** The BPMN read is REQUIRED: guessing "no form" skips validation, guessing "form" resets defaults. */
async function formRules(client: Client, task: TaskRow): Promise<FormFieldSubmitRule[]> {
  if (!task.processDefinitionId || !task.taskDefinitionKey) return []
  const xml = await fetchDefinitionXml(client, task.processDefinitionId)
  return xml ? formFieldSubmitRules(xml, task.taskDefinitionKey) : []
}

/** Read raw so the serialized value + `valueInfo` is the shape a write takes. Engine-readonly fields keep the engine's default, as in Tasklist. */
async function omittedValuesToKeep(
  client: Client,
  taskId: string,
  rules: FormFieldSubmitRule[],
  submitted: VariableMap,
): Promise<VariableMap> {
  const atRisk = rules.filter(
    (rule) => rule.hasDefault && !rule.engineReadonly && !Object.hasOwn(submitted, rule.name),
  )
  if (atRisk.length === 0) return {}
  // Required: without the current values the submit would reset them silently.
  const current = await readTaskVariables(client, taskId)
  return Object.fromEntries(
    atRisk.flatMap(({ name }) => {
      const variable = current[name]
      return variable && variable.value !== null && variable.value !== undefined
        ? [[name, variable]]
        : []
    }),
  )
}

function variablesBody(variables: VariableMap) {
  return { variables: Object.keys(variables).length > 0 ? variables : undefined }
}

export async function completeUserTask(
  client: Client,
  taskId: string,
  variables: Record<string, EngineVariableInput> | undefined,
): Promise<TaskCompletion> {
  // Converted (and refused) before any request: a bad value never half-runs.
  const submitted: VariableMap = toEngineVariables(variables) ?? {}
  const task: TaskRow = await getTask({ client, path: { id: taskId } })
  const delegated = task.delegationState === "PENDING"
  const rules = await formRules(client, task)
  const path = { id: taskId }

  if (rules.length > 0) {
    const kept = await omittedValuesToKeep(client, taskId, rules, submitted)
    await submit({ client, path, body: variablesBody({ ...kept, ...submitted }) })
  } else if (delegated) {
    await resolve({ client, path, body: variablesBody(submitted) })
  } else {
    await complete({ client, path, body: variablesBody(submitted) })
  }

  return delegated
    ? { success: true, taskId, outcome: "resolved", assignee: task.owner ?? null }
    : { success: true, taskId, outcome: "completed" }
}
