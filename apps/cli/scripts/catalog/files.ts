/**
 * Locations of the one Camunda 7 REST spec with its patches applied and of its route table, both
 * written by c7-core's `generate` and read here as files, and of the generated catalog.
 */

import { readFileSync } from "node:fs"
import type { OpenApiDocument } from "./openapi.js"
import { type CatalogRoutes, parseRoutes } from "./routes.js"

const C7_CORE = new URL("../../../../packages/connectors/c7/c7-core/", import.meta.url)

/** c7-core's spec with its `spec/patches.json` applied; derived, so not committed. */
export const SPEC_FILE = new URL("spec/patched/api.json", C7_CORE)
export const ROUTES_FILE = new URL("src/generated/routes.json", C7_CORE)
export const CATALOG_FILE = new URL("../../src/generated/catalog.json", import.meta.url)

/** The text of the patched spec; a missing one fails naming the command that writes it. */
export function readSpecText(file: URL = SPEC_FILE): string {
  try {
    return readFileSync(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    throw new Error(
      `${file.pathname} is missing: run ` +
        "`pnpm --fail-if-no-match --filter @miragon/pulse-c7-core generate` (`pnpm build` runs it)",
      { cause: error },
    )
  }
}

/** The patched spec, parsed. */
export function readSpec(): OpenApiDocument {
  return JSON.parse(readSpecText()) as OpenApiDocument
}

/** c7-core's route table: each operation's effect and engine scope. */
export function readRoutes(): CatalogRoutes {
  return parseRoutes(readFileSync(ROUTES_FILE, "utf8"))
}
