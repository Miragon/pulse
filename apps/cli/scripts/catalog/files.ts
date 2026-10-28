/** Locations of the vendored spec, its patches and the generated catalog. */

import { readFileSync } from "node:fs"
import type { OpenApiDocument } from "./openapi.js"
import { patchedSpec } from "./render.js"

export const SPEC_FILE = new URL("../../spec/camunda7-rest/api.json", import.meta.url)
export const PATCH_FILE = new URL("../../spec/camunda7-rest/patches.json", import.meta.url)
export const CATALOG_FILE = new URL("../../src/generated/catalog.json", import.meta.url)

/** The vendored spec with `spec/camunda7-rest/patches.json` applied. */
export function readPatchedSpec(): OpenApiDocument {
  return patchedSpec(readFileSync(SPEC_FILE, "utf8"), readFileSync(PATCH_FILE, "utf8"))
}
