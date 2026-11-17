import type { CockpitSection, EngineDialect } from "./view-models.js"

/** Every dialect the server reads, in the profile format's order. */
export const EVERY_DIALECT: readonly EngineDialect[] = ["c7", "c8"]

/**
 * Each cockpit route's mark: the dialects whose engines it serves, beside `COCKPIT_ROUTES`
 * (`data/routes.ts`), which reads its feeds. The one source of what a route serves: the boot
 * offers a route only where a configured engine speaks one of its dialects (`engine_open_cockpit`'s
 * `view`), a call refuses an engine of another (ENGINE_DIALECT_NOT_SERVED), and the cockpit shows
 * an engine only the sections its dialect is served by. A route of one engine reads the Camunda 7
 * REST API; a board reads its engines through the engine contract, the landing none.
 */
export const ROUTE_DIALECTS: { readonly [S in CockpitSection]: readonly EngineDialect[] } = {
  overview: ["c7"],
  incidents: ["c7"],
  "cluster-detail": ["c7"],
  "process-detail": ["c7"],
  "process-instances": ["c7"],
  "instance-detail": ["c7"],
  "incident-detail": ["c7"],
  jobs: ["c7"],
  history: ["c7"],
  board: EVERY_DIALECT,
  landing: EVERY_DIALECT,
}

/**
 * Whether the route of `section` serves an engine of `dialect`; a refused profile's dialect is
 * unread, and its routes show its refusal (`RefusedEngineGate`), as a Camunda 7 engine's would.
 */
export function routeServes(section: CockpitSection, dialect: EngineDialect | undefined): boolean {
  return ROUTE_DIALECTS[section].includes(dialect ?? "c7")
}
