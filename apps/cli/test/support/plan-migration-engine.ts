/**
 * A fake engine for the unit tests of `pulse plan-migration` (src/workflow/plan-migration*.test):
 * the definitions of a process by version (the highest for `latestVersion=true`), the plan the
 * engine proposes and its check, each answer chosen by the test.
 */

import { type FakeServer, fakeServer, json, type RecordedRequest } from "./fake-fetch.js"

export interface DefinitionRow {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly tenantId?: string | null
}

export const V1: DefinitionRow = { id: "invoice:1:def-1", key: "invoice", version: 1 }
export const V2: DefinitionRow = { id: "invoice:2:def-2", key: "invoice", version: 2 }

/** Where the plan of invoice from v1 to v2 is written without --plan-file. */
export const PLAN_PATH = ".pulse/migrations/invoice-v1-to-v2.migration.json"

export function instruction(sources: readonly string[], targets: readonly string[]) {
  return { sourceActivityIds: sources, targetActivityIds: targets, updateEventTrigger: false }
}

export const PROPOSAL = [instruction(["approve"], ["approve"]), instruction(["check"], ["check"])]

/** The JSON body of a request; undefined without one. */
export function bodyOf(request: RecordedRequest | undefined): unknown {
  return typeof request?.body === "string" ? JSON.parse(request.body) : undefined
}

export interface PlanEngineOptions {
  readonly definitions?: readonly DefinitionRow[]
  readonly instructions?: readonly object[]
  readonly reports?: readonly object[]
}

export function planEngine(options: PlanEngineOptions = {}): FakeServer {
  const rows = options.definitions ?? [V1, V2]
  const highest = Math.max(...rows.map((row) => row.version))
  return fakeServer()
    .on("GET", "/process-definition", (request) => {
      const version = request.query.get("version")
      const found = rows.filter((row) =>
        version === null ? row.version === highest : String(row.version) === version,
      )
      return json(found.slice(0, Number(request.query.get("maxResults"))))
    })
    .on("POST", "/migration/generate", (request) => {
      const body = bodyOf(request) as Record<string, unknown>
      return json({
        sourceProcessDefinitionId: body.sourceProcessDefinitionId,
        targetProcessDefinitionId: body.targetProcessDefinitionId,
        instructions: options.instructions ?? PROPOSAL,
        variables: null,
      })
    })
    .on("POST", "/migration/validate", json({ instructionReports: options.reports ?? [] }))
}

/** The requests of the engine, `METHOD /path`. */
export function sentRoutes(server: FakeServer): string[] {
  return server.requests.map((request) => `${request.method} ${request.path}`)
}
