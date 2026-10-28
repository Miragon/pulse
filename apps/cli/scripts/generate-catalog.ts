/**
 * Regenerates `src/generated/catalog.json`, the catalog of every engine, from the vendored OpenAPI
 * spec and `spec/camunda7-rest/patches.json`.
 * Usage: pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog (or catalog:check)
 * With --check the script fails if the committed catalog is out of date instead of writing it.
 */

import { readFile, writeFile } from "node:fs/promises"
import { CATALOG_FILE, PATCH_FILE, SPEC_FILE } from "./catalog/files.js"
import { renderCatalog } from "./catalog/render.js"

const rendered = renderCatalog(
  await readFile(SPEC_FILE, "utf8"),
  await readFile(PATCH_FILE, "utf8"),
)
if (process.argv.includes("--check")) {
  const current = await readFile(CATALOG_FILE, "utf8").catch(() => "")
  if (current !== rendered) {
    console.error(
      "src/generated/catalog.json is out of date. Run `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`.",
    )
    process.exitCode = 1
  }
} else {
  await writeFile(CATALOG_FILE, rendered)
  console.log(`Wrote ${CATALOG_FILE.pathname}`)
}
