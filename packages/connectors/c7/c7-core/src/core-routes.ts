/**
 * The routes of the operations c7-core sends (`CORE_OPERATIONS`: the composites' reads and the
 * wait's counts, every one a read), picked from the route table by scripts/generate-routes.ts.
 * Small enough for every bundle that runs c7-core; the whole table is
 * `@miragon/pulse-c7-core/routes`.
 */

import routes from "./generated/core-routes.json" with { type: "json" }
import type { Routes } from "./route.js"

/** The route of each operation c7-core sends, by operation id. */
export const CORE_ROUTES: Routes = routes as Routes
