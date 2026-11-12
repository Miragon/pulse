/**
 * Contract of the engine seam: a spec that renames a body field (RetriesDto.retries → retryCount,
 * as an engine's own patch on top of c7-core's spec/patches.json would) flows through the generator
 * into the commands, help and describe of the adapter that carries that catalog only.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ROUTES_FILE, readSpecText } from "../../scripts/catalog/files.js"
import { renderCatalog } from "../../scripts/catalog/render.js"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import type { Catalog } from "../catalog/types.js"
import type { CliContext } from "./context.js"
import { createProgram } from "./program.js"
import { ENGINES } from "../engines/index.js"

interface RetriesSpec {
  readonly components: { schemas: { RetriesDto: { properties: Record<string, unknown> } } }
}

/** The patched spec with RetriesDto's `retries` renamed `retryCount`, as a text. */
function renameRetries(specText: string): string {
  const spec = JSON.parse(specText) as RetriesSpec
  const properties = spec.components.schemas.RetriesDto.properties
  properties.retryCount = properties.retries
  delete properties.retries
  return JSON.stringify(spec)
}

const routesText = readFileSync(ROUTES_FILE, "utf8")
const diverging = JSON.parse(renderCatalog(renameRetries(readSpecText()), routesText)) as Catalog

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
