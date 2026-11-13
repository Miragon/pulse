/** Renders what the generator writes from the spec and its patches; shared by it and the tests. */

import type { Routes } from "../src/route.js"
import { buildRoutes, pickRoutes } from "./build-routes.js"
import type { OpenApiDocument } from "./openapi.js"
import { applyPatch, type PatchOperation } from "./patches.js"

/** The spec with the RFC 6902 patches of spec/patches.json applied: what every generator reads. */
export function patchedSpec(specText: string, patchText: string): OpenApiDocument {
  const patches = JSON.parse(patchText) as PatchOperation[]
  return applyPatch(JSON.parse(specText) as OpenApiDocument, patches)
}

/** The content of a route table file: one route per line, keyed by its operation id. */
export function renderRoutes(routes: Routes): string {
  const lines = Object.entries(routes).map(
    ([operationId, route]) => ` ${JSON.stringify(operationId)}: ${JSON.stringify(route)}`,
  )
  return `{\n${lines.join(",\n")}\n}\n`
}

/**
 * The text of the patched spec (spec/patched/api.json), of src/generated/routes.json (every
 * operation) and of src/generated/core-routes.json (`core` only).
 */
export interface RenderedFiles {
  readonly spec: string
  readonly routes: string
  readonly core: string
}

/** The patched spec and the two route tables built from it, from the texts of spec and patches. */
export function renderFiles(
  specText: string,
  patchText: string,
  core: readonly string[],
): RenderedFiles {
  const spec = patchedSpec(specText, patchText)
  const routes = buildRoutes(spec)
  return {
    spec: `${JSON.stringify(spec, null, 2)}\n`,
    routes: renderRoutes(routes),
    core: renderRoutes(pickRoutes(routes, core)),
  }
}
