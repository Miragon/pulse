/**
 * The effect rule: what an operation does to engine state (read, write, delete, bulk), from its
 * method, its operation id, its path, its JSON body and its answers. The one home of the rule: the
 * route table carries each operation's effect, and the CLI's catalog takes it from there.
 */

import type { Effect, RouteMethod } from "../src/route.js"

export interface EffectInput {
  readonly operationId: string
  readonly method: RouteMethod
  readonly path: string
  /** The property names of its JSON request body (`allOf` merged); undefined without one. */
  readonly bodyProperties: readonly string[] | undefined
  /** The `$ref` names of the JSON schemas its success answers return. */
  readonly answerSchemas: readonly string[]
}

/** POST endpoints that only read: queries, counts, evaluations, filter executions, checks. */
const READ_ONLY_POST =
  /^(query|postQuery|evaluate|generate|validate|postExecute|checkPassword|verifyUser|getGroupInfo)/

/** Methods that only read: GET, and OPTIONS, which lists the operations a resource offers. */
const READING_METHODS: ReadonlySet<RouteMethod> = new Set(["GET", "OPTIONS"])

/** Operations that touch many resources although the generic rules do not detect it. */
export const BULK_OPERATIONS: ReadonlySet<string> = new Set([
  "deleteProcessDefinitionsByKey",
  "deleteProcessDefinitionsByKeyAndTenantId",
  "updateProcessDefinitionSuspensionStateByKey",
  "updateProcessDefinitionSuspensionStateByKeyAndTenantId",
  "updateProcessDefinitionSuspensionState",
  "updateSuspensionState",
  "updateSuspensionStateBy",
  "updateSuspensionStateJobDefinitions",
  "setExternalTaskRetries",
  "executeMigrationPlan",
  "executeModification",
  "restartProcessInstance",
  "cleanupAsync",
  "deleteTaskMetrics",
])

/** Explicit effects where the HTTP method or the operationId is misleading. */
export const EFFECT_OVERRIDES: ReadonlyMap<string, Effect> = new Map<string, Effect>([
  ["clearIncidentAnnotation", "write"],
  ["clearAnnotationUserOperationLog", "write"],
  // POST /condition matches the read-only `evaluate` prefix but starts process instances
  ["evaluateCondition", "write"],
  // POST /task/{id}/identity-links/delete removes one identity link (command `delete`)
  ["deleteIdentityLink", "delete"],
])

/** Body properties that select many resources. */
const SELECTOR_PROPERTY = /(Query|Ids)$/

/** A body that selects many resources by ids or a query, on a path that names no single one. */
function selectsMany(input: EffectInput): boolean {
  if (input.bodyProperties === undefined || input.path.includes("{")) return false
  return input.bodyProperties.some((name) => SELECTOR_PROPERTY.test(name))
}

export function isReadOnly(input: Pick<EffectInput, "method" | "operationId" | "path">): boolean {
  if (READING_METHODS.has(input.method)) return true
  return (
    input.method === "POST" &&
    (READ_ONLY_POST.test(input.operationId) || input.path.endsWith("/count"))
  )
}

export function classifyEffect(input: EffectInput): Effect {
  const override = EFFECT_OVERRIDES.get(input.operationId)
  if (override !== undefined) return override
  if (isReadOnly(input)) return "read"
  if (BULK_OPERATIONS.has(input.operationId) || input.answerSchemas.includes("BatchDto")) {
    return "bulk"
  }
  if (selectsMany(input)) return "bulk"
  return input.method === "DELETE" ? "delete" : "write"
}
