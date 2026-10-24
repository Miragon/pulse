import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { FLAVORS } from "../../src/config/types.js"
import {
  catalogFile,
  ENGINES,
  enginePatchFile,
  PATCH_FILE,
  SPEC_FILE,
  readPatchedSpec,
} from "./files.js"
import { SPEC_URL, patchedSpec, renderCatalog } from "./render.js"

const specText = readFileSync(SPEC_FILE, "utf8")
const patchText = readFileSync(PATCH_FILE, "utf8")

const enginePatchText = (engine: (typeof ENGINES)[number]) =>
  readFileSync(enginePatchFile(engine), "utf8")

describe("renderCatalog", () => {
  it.each(ENGINES)(
    "renders exactly the committed src/generated/catalog.%s.json (run `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`)",
    (engine) => {
      const rendered = renderCatalog(specText, patchText, enginePatchText(engine))
      expect(rendered === readFileSync(catalogFile(engine), "utf8")).toBe(true)
    },
  )

  // an engine that diverges on purpose gets patches and leaves this list
  it.each(ENGINES)(
    "renders the API catalog for %s while its engine patches are empty",
    (engine) => {
      expect(JSON.parse(enginePatchText(engine))).toEqual([])
      expect(readFileSync(catalogFile(engine), "utf8") === renderCatalog(specText, patchText)).toBe(
        true,
      )
    },
  )

  it("applies the engine patches after those of the API", () => {
    const rename = JSON.stringify([
      { op: "test", path: "/info/title", value: JSON.parse(specText).info.title },
      { op: "replace", path: "/info/title", value: "Engine" },
    ])
    const rendered = JSON.parse(renderCatalog(specText, patchText, rename)) as {
      source: { title: string }
    }
    expect(rendered.source.title).toBe("Engine")
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
  it("points to the vendored spec, the patches and the generated catalogs", () => {
    expect(SPEC_FILE.pathname.endsWith("/spec/camunda7-rest/api.json")).toBe(true)
    expect(PATCH_FILE.pathname.endsWith("/spec/camunda7-rest/patches.json")).toBe(true)
    expect(
      enginePatchFile("cibseven").pathname.endsWith("/spec/engines/cibseven.patches.json"),
    ).toBe(true)
    expect(catalogFile("operaton").pathname.endsWith("/src/generated/catalog.operaton.json")).toBe(
      true,
    )
  })

  it("lists the engines of the CLI", () => {
    expect(ENGINES).toEqual(FLAVORS)
  })

  it("reads the patched spec", () => {
    expect(readPatchedSpec()).toEqual(patchedSpec(specText, patchText))
  })
})
