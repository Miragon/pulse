/**
 * @miragon/pulse-c7-core/routes: the route of every operation of the Camunda 7 REST API (Operaton,
 * CIB seven, Camunda 7), generated from the one spec (spec/api.json, by
 * scripts/generate-routes.ts): method, path template, effect, whether a named engine serves it and
 * the media types of its answers. A table of its own entry, so a bundle that needs only what
 * c7-core sends (`CORE_ROUTES` of the main entry) never carries it.
 */

import routes from "./generated/routes.json" with { type: "json" }
import type { Routes } from "./route.js"

export type { Effect, Route, RouteIntent, RouteMethod, Routes } from "./route.js"

/** The route of every operation of the REST API, by operation id. */
export const ROUTES: Routes = routes as Routes
