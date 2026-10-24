/** Renders the catalog file content from the spec and its patches. Shared by generator and tests. */

import { buildCatalog } from "./build-catalog.js"
import type { OpenApiDocument } from "./openapi.js"
import { type PatchOperation, applyPatch } from "./patches.js"

export const SPEC_URL =
  "https://raw.githubusercontent.com/operaton/operaton-mcp/refs/heads/main/resources/operaton-rest-api.json"

/** Parses the spec and applies the RFC 6902 patches of the API, then those of the engine. */
export function patchedSpec(
  specText: string,
  patchText: string,
  enginePatchText = "[]",
): OpenApiDocument {
  const patches = (text: string) => JSON.parse(text) as PatchOperation[]
  return applyPatch(JSON.parse(specText) as OpenApiDocument, [
    ...patches(patchText),
    ...patches(enginePatchText),
  ])
}

/** The content of `src/generated/catalog.<engine>.json`: indent 1 and a trailing newline. */
export function renderCatalog(specText: string, patchText: string, enginePatchText = "[]"): string {
  const spec = patchedSpec(specText, patchText, enginePatchText)
  return `${JSON.stringify(buildCatalog(spec, SPEC_URL), null, 1)}\n`
}
