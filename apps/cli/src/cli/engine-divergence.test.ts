/**
 * Contract of the engine seam: an engine patch that renames a body field (RetriesDto.retries →
 * retryCount) flows through the generator into the commands, help and describe of that engine only.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PATCH_FILE, SPEC_FILE } from "../../scripts/catalog/files.js"
import { renderCatalog } from "../../scripts/catalog/render.js"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import type { Catalog } from "../catalog/types.js"
import type { CliContext } from "./context.js"
import { createProgram } from "./program.js"
import { ENGINES } from "../engines/index.js"

const RETRIES = "/components/schemas/RetriesDto/properties/retries"
const specText = readFileSync(SPEC_FILE, "utf8")
const retries: unknown = JSON.parse(specText).components.schemas.RetriesDto.properties.retries
const RENAME_RETRIES = JSON.stringify([
  { op: "test", path: RETRIES, value: retries },
  { op: "add", path: "/components/schemas/RetriesDto/properties/retryCount", value: retries },
  { op: "remove", path: RETRIES },
])

const diverging = JSON.parse(
  renderCatalog(specText, readFileSync(PATCH_FILE, "utf8"), RENAME_RETRIES),
) as Catalog

async function output(catalog: Catalog, args: readonly string[]): Promise<string> {
  const runtime = fakeRuntime()
  const engine = { ...ENGINES.cibseven, catalog }
  const context: CliContext = { runtime, engine, catalog, state: {} }
  await createProgram(args, context)
    .parseAsync(args, { from: "user" })
    .catch(() => undefined)
  return runtime.stdout.text()
}

describe("an engine that renames a field", () => {
  it("gets the renamed flag in its help, the other engines keep theirs", async () => {
    const help = await output(diverging, ["job", "set-retries", "--help"])
    expect(help).toContain("--retry-count <n>")
    expect(help).not.toContain("--retries <n>")
    expect(await output(ENGINES.cibseven.catalog, ["job", "set-retries", "--help"])).toContain(
      "--retries <n>",
    )
  })

  it("describes and sends the renamed field", async () => {
    const described = await output(diverging, ["describe", "job", "set-retries", "-o", "json"])
    expect(described).toContain('"flag":"--retry-count <n>"')
    const args = ["job", "set-retries", "j1", "--retry-count", "3", "--dry-run", "-o", "json"]
    expect(JSON.parse(await output(diverging, args))).toMatchObject({ body: { retryCount: 3 } })
  })
})
