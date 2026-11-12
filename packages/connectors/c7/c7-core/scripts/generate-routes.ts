/**
 * Applies spec/patches.json to the one Camunda 7 REST spec and writes what is generated from it:
 * the patched spec (spec/patched/api.json, ignored by git; c7-client's SDK and the CLI's catalog
 * read it), src/generated/routes.json (every operation, `./routes`) and
 * src/generated/core-routes.json (the operations c7-core sends, `CORE_ROUTES`). Turbo runs it as
 * the package's `generate`, before every build; by hand:
 * pnpm --fail-if-no-match --filter @miragon/pulse-c7-core generate
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { CORE_OPERATIONS } from "../src/operations.js"
import { CORE_ROUTES_FILE, PATCH_FILE, PATCHED_SPEC_FILE, ROUTES_FILE, SPEC_FILE } from "./files.js"
import { renderFiles } from "./render.js"

const files = renderFiles(
  await readFile(SPEC_FILE, "utf8"),
  await readFile(PATCH_FILE, "utf8"),
  CORE_OPERATIONS,
)
const written: readonly (readonly [URL, string])[] = [
  [PATCHED_SPEC_FILE, files.spec],
  [ROUTES_FILE, files.routes],
  [CORE_ROUTES_FILE, files.core],
]
for (const [file, text] of written) {
  await mkdir(new URL(".", file), { recursive: true })
  await writeFile(file, text)
  process.stdout.write(`Wrote ${file.pathname}\n`)
}
