import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  blindGlossaryRules,
  COUNT_TERMS,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  sourceTexts,
} from "@miragon/pulse-ui/testing"
import { afterAll, describe, expect, test } from "vitest"
import { PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, REPO_ROOT } from "./support/files.js"
import {
  ENGINE_CORE_SOURCES,
  HOST_LAYERS,
  HOST_SOURCES,
  RUNTIME_VIEW_LAYERS,
  RUNTIME_VIEW_SOURCES,
  WEBVIEW,
  WORDED_LAYERS,
} from "./support/layers.js"

function wordFindings(root: string): string[] {
  return glossaryFindings(sourceTexts(root), PRODUCT_GLOSSARY.en).map(
    (finding) => `${finding.key}: "${finding.text}", write ${finding.use}`,
  )
}

function layersOf(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

describe("the extension's texts", PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, () => {
  test("are read in every layer of the runtime view and the host, the C7 adapter aside", () => {
    expect(layersOf(RUNTIME_VIEW_SOURCES)).toEqual([...RUNTIME_VIEW_LAYERS].sort())
    expect(layersOf(HOST_SOURCES)).toEqual([...HOST_LAYERS].sort())
  })

  test.each(WORDED_LAYERS)("in %s use the product's words, never their synonyms", (_, layer) => {
    expect(wordFindings(layer)).toEqual([])
  })

  test("in engine-core, whose contract the runtime view speaks, use the product's words too", () => {
    const contract = join(REPO_ROOT, ENGINE_CORE_SOURCES)
    expect(Object.keys(sourceTexts(contract))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^model\/move-reasons\.ts:/)]),
    )
    expect(wordFindings(contract)).toEqual([])
  })

  test("name the counts with the count terms the MCP widgets use", () => {
    const texts = Object.values(sourceTexts(WEBVIEW))
    expect(texts).toContain(COUNT_TERMS.withIncident.en)
    expect(texts).toContain(COUNT_TERMS.incidents.en)
  })

  test("name the version scope of the counts over every version, in the overview and the tree", () => {
    const coreTexts = Object.entries(sourceTexts(join(RUNTIME_VIEW_SOURCES, "core")))
    const scoped = (file: string) =>
      coreTexts
        .filter(([key]) => key.startsWith(file))
        .some(([, text]) => text.includes(COUNT_TERMS.allVersions.en))
    expect(scoped("views/engine-view-builder.ts")).toBe(true)
    expect(scoped("explorer/definition-nodes.ts")).toBe(true)
  })

  test("are held to rules that each catch their own probe", () => {
    expect(blindGlossaryRules(PRODUCT_GLOSSARY.en)).toEqual([])
  })
})

describe("the word scan", PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, () => {
  const root = mkdtempSync(join(tmpdir(), "product-words-"))
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("flags a synonym in a literal, a template and JSX text, and spares live updates", () => {
    mkdirSync(join(root, "screens"))
    writeFileSync(
      join(root, "screens", "probe.tsx"),
      [
        'export const scope = "With incidents"',
        "export const note = (id: string) => `Instance ${id} paused`",
        "export const Live = () => <button>Pause live updates</button>",
        "export const Chip = () => <p>Paused instances</p>",
      ].join("\n"),
    )
    expect(wordFindings(root)).toEqual([
      'screens/probe.tsx:2:37: "Instance  paused", write suspend, suspended',
      'screens/probe.tsx:4:30: "Paused instances", write suspend, suspended',
      `screens/probe.tsx:1:22: "With incidents", write ${COUNT_TERMS.withIncident.en}`,
    ])
  })
})
