/**
 * The effect and the engine scope of each operation come from c7-core's route table
 * (packages/connectors/c7/c7-core/src/generated/routes.json), generated from the same spec and read
 * here as data, so the effect rule has one home (c7-core's scripts/effects.ts).
 */

import { EFFECTS, type Effect, type HttpMethod } from "../../src/catalog/types.js"

/** What the catalog takes from a route, and what it checks the route against. */
export interface CatalogRoute {
  readonly method: string
  readonly path: string
  readonly effect: Effect
  readonly engineScoped: boolean
}

export type CatalogRoutes = Readonly<Record<string, CatalogRoute>>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRoute(value: unknown): value is CatalogRoute {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    typeof value.path === "string" &&
    (EFFECTS as readonly unknown[]).includes(value.effect) &&
    typeof value.engineScoped === "boolean"
  )
}

/** The route table from its file's text; fails on a table or a route the catalog cannot read. */
export function parseRoutes(text: string): CatalogRoutes {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error("The route table is no JSON object")
  const unreadable = Object.keys(parsed).find((operationId) => !isRoute(parsed[operationId]))
  if (unreadable !== undefined) throw new Error(`The route of ${unreadable} is unreadable`)
  return parsed as CatalogRoutes
}

/**
 * The route of an operation. Fails when the table lacks it or has it under another method or
 * path: the table is older than the spec, so c7-core's `generate` has to run first.
 */
export function routeFor(
  routes: CatalogRoutes,
  operationId: string,
  method: HttpMethod,
  path: string,
): CatalogRoute {
  const route = Object.hasOwn(routes, operationId) ? routes[operationId] : undefined
  if (route?.method !== method || route.path !== path) {
    throw new Error(
      `${method} ${path} (${operationId}) is not in c7-core's route table: run ` +
        "`pnpm --fail-if-no-match --filter @miragon/pulse-c7-core generate`",
    )
  }
  return route
}
