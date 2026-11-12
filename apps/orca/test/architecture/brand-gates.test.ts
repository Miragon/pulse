import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  glossaryFindings,
  PRODUCT_GLOSSARY,
  scanColors,
  scanGlyphs,
  sourceTexts,
} from "@miragon/pulse-ui/testing"
import { afterAll, describe, expect, test } from "vitest"
import {
  PACKAGE_ROOT,
  PARSING_SOURCES_ON_A_BUSY_CI_RUNNER,
  PLUGIN_SOURCES,
  REPO_ROOT,
} from "./support/files.js"
import { PromiseWords } from "./support/promise-words.js"

const PROMISE_RULES = "test/architecture/support/promise-words.ts"

const STATE_TEXTS: Readonly<Record<string, string>> = {
  "No boards yet.":
    "the project holds no board file, and the panel offers to create one: a state of the project, no feature",
  "Node 21 or later":
    "the Node releases the worker runs on: later names releases of Node, not a feature of Pulse",
}

function wordFindings(root: string): string[] {
  return glossaryFindings(sourceTexts(root), PRODUCT_GLOSSARY.en).map(
    (finding) => `${finding.key}: "${finding.text}", write ${finding.use}`,
  )
}

function plant(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

describe("the plugin's own texts", PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, () => {
  test("are read in every part of the plugin: the worker, the panel and the editor frames", () => {
    const parts = readdirSync(PLUGIN_SOURCES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(parts).toEqual(["editor", "panel", "worker"])
    expect(Object.keys(sourceTexts(PLUGIN_SOURCES))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^panel\/engines\.tsx:/),
        expect.stringMatching(/^worker\/engine-registry\.ts:/),
      ]),
    )
  })

  test("use the product's words, never their synonyms", () => {
    expect(wordFindings(PLUGIN_SOURCES)).toEqual([])
  })

  test("draw no glyph, emoji or sparkle as an icon", () => {
    expect(scanGlyphs(PLUGIN_SOURCES)).toEqual([])
  })

  test("name no raw colour", () => {
    expect(scanColors(PLUGIN_SOURCES)).toEqual([])
  })

  test("say what Pulse does today and promise no later feature", () => {
    expect(PromiseWords.scan(PLUGIN_SOURCES, STATE_TEXTS)).toEqual([])
  })

  test("promise no later feature in the manifest Orca shows either", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "orca-plugin.json"), "utf8"),
    ) as unknown
    const texts = PromiseWords.jsonTexts(manifest, "orca-plugin.json")
    expect(Object.keys(texts)).toEqual(
      expect.arrayContaining(["orca-plugin.json.description", "orca-plugin.json.cover.alt"]),
    )
    expect(PromiseWords.findings(texts, STATE_TEXTS)).toEqual([])
  })

  test("keep a promise word only in a state text the allowance names with its reason", () => {
    const texts = PromiseWords.texts(PLUGIN_SOURCES)
    expect(PromiseWords.allowanceFindings(texts, STATE_TEXTS)).toEqual([])
  })
})

describe("the promise scan", PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, () => {
  const root = mkdtempSync(join(tmpdir(), "promise-words-"))
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("holds the rules of Pulse for VS Code, word for word, each catching its own probe", () => {
    expect(readFileSync(join(PACKAGE_ROOT, PROMISE_RULES), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "apps/vscode", PROMISE_RULES), "utf8"),
    )
    expect(PromiseWords.blindRules()).toEqual([])
  })

  test("flags the retired promises of the editors and a new one in the panel, and spares a state text", () => {
    plant(join(root, "plugin"), {
      "panel/boards.tsx": "export const Empty = () => <p>No boards yet.</p>",
      "panel/engines.tsx": "export const Writes = () => <p>Writes on remote engines follow</p>",
      "worker/notes.ts": [
        "export const source = (label: string) => `The token waits at the gateway ${label}; Pulse does not move it yet.`",
        'export const target = "Pulse does not start multi-instance elements yet."',
        'export const note = "Read-only. Pulse cannot change data on this engine yet."',
      ].join("\n"),
    })
    expect(PromiseWords.scan(join(root, "plugin"), STATE_TEXTS)).toEqual([
      'panel/engines.tsx:1:32: "Writes on remote engines follow" promises a later feature (follows)',
      'worker/notes.ts:1:42: "The token waits at the gateway {value}; Pulse does not move it yet." promises a later feature (not … yet)',
      'worker/notes.ts:2:23: "Pulse does not start multi-instance elements yet." promises a later feature (not … yet)',
      'worker/notes.ts:3:21: "Read-only. Pulse cannot change data on this engine yet." promises a later feature (not … yet)',
    ])
  })

  test("reads a sentence a value or a tag splits as one, and spares a state text in it", () => {
    plant(join(root, "split"), {
      "panel/engines.tsx": [
        "export const Remote = (props: { name: string }) => <p>Pulse does not write to {props.name} yet.</p>",
        "export const Boards = (props: { count: number }) => <p>No boards yet. <b>{props.count}</b> models</p>",
      ].join("\n"),
      "worker/notes.ts":
        'export const note = (name: string) => "Pulse does not reach " + name + " yet."',
    })
    expect(PromiseWords.scan(join(root, "split"), STATE_TEXTS)).toEqual([
      'panel/engines.tsx:1:52: "Pulse does not write to {value} yet." promises a later feature (not … yet)',
      'worker/notes.ts:1:39: "Pulse does not reach {value} yet." promises a later feature (not … yet)',
    ])
  })

  test("flags an allowance that spares no promise word or no text", () => {
    const allowed = { "No boards yet.": "a probe", "Open a board": "a probe", Soon: "a probe" }
    expect(PromiseWords.allowanceFindings(["No boards yet."], allowed)).toEqual([
      '"Open a board": spares no promise word (a probe)',
      '"Soon": unused allowance (a probe)',
    ])
  })
})
