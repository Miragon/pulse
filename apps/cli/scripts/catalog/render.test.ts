import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CATALOG_FILE, PATCH_FILE, SPEC_FILE, readPatchedSpec } from "./files.js"
import { SPEC_URL, patchedSpec, renderCatalog } from "./render.js"

const specText = readFileSync(SPEC_FILE, "utf8")
const patchText = readFileSync(PATCH_FILE, "utf8")

describe("renderCatalog", () => {
  it("renders exactly the committed src/generated/catalog.json (run `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`)", () => {
    expect(renderCatalog(specText, patchText) === readFileSync(CATALOG_FILE, "utf8")).toBe(true)
  })

  it("indents with one space and ends with a single newline", () => {
    const rendered = renderCatalog(specText, patchText)
    expect(rendered.startsWith('{\n "source": {\n  "title": ')).toBe(true)
    expect(rendered.endsWith("}\n")).toBe(true)
    expect(rendered.endsWith("\n\n")).toBe(false)
  })

  it("is deterministic", () => {
    expect(renderCatalog(specText, patchText)).toBe(renderCatalog(specText, patchText))
  })

  it("records the upstream spec URL", () => {
    expect(SPEC_URL).toBe(
      "https://raw.githubusercontent.com/operaton/operaton-mcp/refs/heads/main/resources/operaton-rest-api.json",
    )
    const rendered = renderCatalog(specText, patchText)
    expect((JSON.parse(rendered) as { source: { url: string } }).source.url).toBe(SPEC_URL)
  })
})

describe("patchedSpec", () => {
  it("applies spec/camunda7-rest/patches.json to the vendored spec", () => {
    const raw = JSON.parse(specText) as { paths: Record<string, unknown> }
    const patched = patchedSpec(specText, patchText)
    const path = "/history/variable-instance"
    const parameterSchema = (document: unknown) =>
      (document as { paths: Record<string, { get: { parameters: { schema: unknown }[] } }> }).paths[
        path
      ]?.get.parameters[2]?.schema
    expect(parameterSchema(raw)).toMatchObject({ type: "object" })
    expect(parameterSchema(patched)).toEqual({ type: "string" })
  })

  it("fails when a patch guard no longer matches", () => {
    const guard = JSON.stringify([{ op: "test", path: "/info/title", value: "Something else" }])
    expect(() => patchedSpec(specText, guard)).toThrow(
      new Error("JSON patch test failed at /info/title"),
    )
  })

  it("renders an unpatched spec differently", () => {
    expect(renderCatalog(specText, "[]")).not.toBe(renderCatalog(specText, patchText))
  })
})

describe("files", () => {
  it("points to the vendored spec, the patches and the generated catalog", () => {
    expect(SPEC_FILE.pathname.endsWith("/spec/camunda7-rest/api.json")).toBe(true)
    expect(PATCH_FILE.pathname.endsWith("/spec/camunda7-rest/patches.json")).toBe(true)
    expect(CATALOG_FILE.pathname.endsWith("/src/generated/catalog.json")).toBe(true)
  })

  it("reads the patched spec", () => {
    expect(readPatchedSpec()).toEqual(patchedSpec(specText, patchText))
  })
})
