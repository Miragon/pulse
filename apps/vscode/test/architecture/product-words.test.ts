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
import { APP_ROOT } from "./support/files.js"
import { ENGINE_VOCABULARY_LAYER, WORDED_LAYERS } from "./support/layers.js"

const SOURCES = join(APP_ROOT, "src")

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

describe("the extension's texts", () => {
  test("are read in every layer that words what a user sees, the engine adapters aside", () => {
    expect(layersOf(SOURCES)).toEqual([ENGINE_VOCABULARY_LAYER, ...WORDED_LAYERS].sort())
  })

  test.each(WORDED_LAYERS)("in %s use the product's words, never their synonyms", (layer) => {
    expect(wordFindings(join(SOURCES, layer))).toEqual([])
  })

  test("name the counts with the count terms the MCP widgets use", () => {
    const texts = Object.values(sourceTexts(join(SOURCES, "webview")))
    expect(texts).toContain(COUNT_TERMS.withIncident.en)
    expect(texts).toContain(COUNT_TERMS.incidents.en)
  })

  test("name the version scope of the counts over every version, in the overview and the tree", () => {
    const scoped = (file: string) =>
      Object.entries(sourceTexts(join(SOURCES, "core")))
        .filter(([key]) => key.startsWith(file))
        .some(([, text]) => text.includes(COUNT_TERMS.allVersions.en))
    expect(scoped("views/engine-view-builder.ts")).toBe(true)
    expect(scoped("explorer/definition-nodes.ts")).toBe(true)
  })

  test("are held to rules that each catch their own probe", () => {
    expect(blindGlossaryRules(PRODUCT_GLOSSARY.en)).toEqual([])
  })
})

describe("the word scan", () => {
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
