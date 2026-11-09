import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  CATALOG_FILE,
  ROUTES_FILE,
  SPEC_FILE,
  readRoutes,
  readSpec,
  readSpecText,
} from "./files.js"
import { SPEC_URL, renderCatalog } from "./render.js"

const specText = readSpecText()
const routesText = readFileSync(ROUTES_FILE, "utf8")

describe("renderCatalog", () => {
  it("renders exactly the committed src/generated/catalog.json (run `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`)", () => {
    const rendered = renderCatalog(specText, routesText)
    expect(rendered === readFileSync(CATALOG_FILE, "utf8")).toBe(true)
  })

  it("indents with one space and ends with a single newline", () => {
    const rendered = renderCatalog(specText, routesText)
    expect(rendered.startsWith('{\n "source": {\n  "title": ')).toBe(true)
    expect(rendered.endsWith("}\n")).toBe(true)
    expect(rendered.endsWith("\n\n")).toBe(false)
  })

  it("is deterministic", () => {
    expect(renderCatalog(specText, routesText)).toBe(renderCatalog(specText, routesText))
  })

  it("records the upstream spec URL", () => {
    expect(SPEC_URL).toBe(
      "https://raw.githubusercontent.com/operaton/operaton-mcp/refs/heads/main/resources/operaton-rest-api.json",
    )
    const rendered = renderCatalog(specText, routesText)
    expect((JSON.parse(rendered) as { source: { url: string } }).source.url).toBe(SPEC_URL)
  })

  it("takes each effect from the route table", () => {
    const routes = JSON.parse(routesText) as Record<string, { effect: string }>
    const flipped = { ...routes, getJobs: { ...routes.getJobs, effect: "bulk" } }
    const catalog = JSON.parse(renderCatalog(specText, JSON.stringify(flipped))) as {
      operations: { operationId: string; effect: string }[]
    }
    expect(catalog.operations.find((op) => op.operationId === "getJobs")?.effect).toBe("bulk")
  })
})

describe("files", () => {
  it("points to c7-core's patched spec and route table and to the generated catalog", () => {
    const c7Core = "/packages/connectors/c7/c7-core/"
    expect(SPEC_FILE.pathname.endsWith(`${c7Core}spec/patched/api.json`)).toBe(true)
    expect(ROUTES_FILE.pathname.endsWith(`${c7Core}src/generated/routes.json`)).toBe(true)
    expect(CATALOG_FILE.pathname.endsWith("/apps/cli/src/generated/catalog.json")).toBe(true)
  })

  it("reads the spec with c7-core's spec/patches.json applied, and the route table", () => {
    type Paths = Record<string, { get: { parameters: { name: string; schema: unknown }[] } }>
    const paths = readSpec().paths as unknown as Paths
    expect(paths["/history/variable-instance"]?.get.parameters[2]).toMatchObject({
      name: "variableValue",
      schema: { type: "string" },
    })
    expect(Object.keys(readRoutes())).toHaveLength(399)
  })

  it("names the command that writes a missing spec, and rethrows any other failure", () => {
    const missing = new URL("./no-such-spec.json", SPEC_FILE)
    expect(() => readSpecText(missing)).toThrow(
      new Error(
        `${missing.pathname} is missing: run ` +
          "`pnpm --fail-if-no-match --filter @miragon/pulse-c7-core generate` (`pnpm build` runs it)",
      ),
    )
    expect(() => readSpecText(new URL(".", SPEC_FILE))).toThrow(/EISDIR/)
  })
})
