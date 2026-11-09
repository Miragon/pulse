/** Renders the catalog file content from the patched spec. Shared by generator and tests. */

import { buildCatalog } from "./build-catalog.js"
import type { OpenApiDocument } from "./openapi.js"
import { parseRoutes } from "./routes.js"

export const SPEC_URL =
  "https://raw.githubusercontent.com/operaton/operaton-mcp/refs/heads/main/resources/operaton-rest-api.json"

/**
 * The content of `src/generated/catalog.json` from the spec with its patches applied and
 * c7-core's route table: indent 1 and a trailing newline.
 */
export function renderCatalog(specText: string, routesText: string): string {
  const spec = JSON.parse(specText) as OpenApiDocument
  return `${JSON.stringify(buildCatalog(spec, SPEC_URL, parseRoutes(routesText)), null, 1)}\n`
}
