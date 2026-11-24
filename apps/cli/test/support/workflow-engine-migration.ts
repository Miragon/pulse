/**
 * The migration routes of the scripted workflow engine (workflow-engine-routes.ts spreads them):
 * `POST /migration/generate` maps the elements every process definition of the fake has one to
 * one, and `POST /migration/validate` reports each instruction that names an element they lack.
 * The lookups of the versions are `GET /process-definition`, a route of the engine itself.
 */

import { json, type RecordedRequest } from "./fake-fetch.js"

/** The elements of every process definition of the fake engine. */
export const ELEMENTS: readonly string[] = ["approve", "book"]

type Route = (request: RecordedRequest, match: RegExpExecArray) => Response

interface Instruction {
  readonly sourceActivityIds: readonly string[]
  readonly targetActivityIds: readonly string[]
}

function bodyOf<T>(request: RecordedRequest): Partial<T> {
  return JSON.parse(typeof request.body === "string" ? request.body : "{}") as Partial<T>
}

function generate(request: RecordedRequest): Response {
  const body = bodyOf<{ sourceProcessDefinitionId: string; targetProcessDefinitionId: string }>(
    request,
  )
  return json({
    sourceProcessDefinitionId: body.sourceProcessDefinitionId,
    targetProcessDefinitionId: body.targetProcessDefinitionId,
    instructions: ELEMENTS.map((id) => ({
      sourceActivityIds: [id],
      targetActivityIds: [id],
      updateEventTrigger: false,
    })),
    variables: null,
  })
}

function failures(instruction: Instruction): string[] {
  const unknown = (ids: readonly string[]) => ids.filter((id) => !ELEMENTS.includes(id))
  return [
    ...unknown(instruction.sourceActivityIds).map((id) => `Source activity '${id}' does not exist`),
    ...unknown(instruction.targetActivityIds).map((id) => `Target activity '${id}' does not exist`),
  ]
}

function validate(request: RecordedRequest): Response {
  const instructions = bodyOf<{ instructions: Instruction[] }>(request).instructions ?? []
  return json({
    instructionReports: instructions.flatMap((instruction) => {
      const found = failures(instruction)
      return found.length === 0 ? [] : [{ instruction, failures: found }]
    }),
    variableReports: {},
  })
}

export function migrationRoutes(): [string, RegExp, Route][] {
  return [
    ["POST", /^\/migration\/generate$/, generate],
    ["POST", /^\/migration\/validate$/, validate],
  ]
}
