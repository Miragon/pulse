/**
 * Regenerates `src/generated/catalog.json`, the catalog of every engine, from the one Camunda 7
 * REST spec with its patches applied and its route table (each operation's effect), both written
 * by c7-core's `generate` (packages/connectors/c7/c7-core: spec/patched/api.json from spec/api.json
 * and spec/patches.json, src/generated/routes.json).
 * Usage: pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog (or catalog:check)
 * With --check the script fails if the committed catalog is out of date instead of writing it.
 */

import { readFile, writeFile } from "node:fs/promises"
import { CATALOG_FILE, ROUTES_FILE, readSpecText } from "./catalog/files.js"
import { renderCatalog } from "./catalog/render.js"

const rendered = renderCatalog(readSpecText(), await readFile(ROUTES_FILE, "utf8"))
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
