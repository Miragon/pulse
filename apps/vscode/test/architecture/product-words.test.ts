import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  blindGlossaryRules,
  COUNT_TERMS,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  sourceTexts,
} from "@miragon/pulse-ui/testing"
import { afterAll, describe, expect, test } from "vitest"
import { APP_ROOT, PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, REPO_ROOT } from "./support/files.js"
import {
  ENGINE_CORE_SOURCES,
  HOST_LAYERS,
  HOST_SOURCES,
  RUNTIME_VIEW_LAYERS,
  RUNTIME_VIEW_SOURCES,
  SHOWN_PACKAGES,
  WEBVIEW,
  WORDED_LAYERS,
} from "./support/layers.js"
import { PromiseWords } from "./support/promise-words.js"

const STATE_TEXTS: Readonly<Record<string, string>> = {
  "Not called yet":
    "a call activity that has no called instance, so its link opens the called process: a state of the instance, no feature",
  "Refresh later to see the result.":
    "a retried incident still waiting for its next attempt after a minute: later is when the user looks again, no feature",
}

const NOT_SHIPPED = ["testing/", "generated/"]

function wordFindings(root: string): string[] {
  return glossaryFindings(sourceTexts(root), PRODUCT_GLOSSARY.en).map(
    (finding) => `${finding.key}: "${finding.text}", write ${finding.use}`,
  )
}

function manifestTexts(): Record<string, string> {
  const read = (path: string): unknown => JSON.parse(readFileSync(join(APP_ROOT, path), "utf8"))
  const { displayName, description, contributes } = read("package.json") as Record<string, unknown>
  const schemas = readdirSync(join(APP_ROOT, "schemas")).map((name) =>
    PromiseWords.jsonTexts(read(`schemas/${name}`), `schemas/${name}`),
  )
  return Object.fromEntries(
    [
      PromiseWords.jsonTexts({ displayName, description, contributes }, "package.json"),
      ...schemas,
    ].flatMap((texts) => Object.entries(texts)),
  )
}

function plant(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
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

  test.each(WORDED_LAYERS)(
    "in %s say what Pulse does today and promise no later feature",
    (_, layer) => {
      expect(PromiseWords.scan(layer, STATE_TEXTS)).toEqual([])
    },
  )

  test.each(SHOWN_PACKAGES)(
    "in %s, whose texts both editors show, promise no later feature either",
    (_, sources) => {
      const root = join(REPO_ROOT, sources)
      expect(PromiseWords.texts(root, NOT_SHIPPED).length).toBeGreaterThan(0)
      expect(PromiseWords.scan(root, STATE_TEXTS, NOT_SHIPPED)).toEqual([])
    },
  )

  test("in the manifest and the board schema, which VS Code shows, promise no later feature", () => {
    const texts = manifestTexts()
    expect(Object.keys(texts)).toEqual(
      expect.arrayContaining([
        "package.json.description",
        expect.stringMatching(/^package\.json\.contributes\.commands\[\d+\]\.title$/),
        expect.stringMatching(/^schemas\/board\.schema\.json\..*description$/),
      ]),
    )
    expect(PromiseWords.findings(texts, STATE_TEXTS)).toEqual([])
  })

  test("keep a promise word only in a state text the allowance names with its reason", () => {
    const texts = WORDED_LAYERS.flatMap(([, layer]) => PromiseWords.texts(layer))
    expect(PromiseWords.allowanceFindings(texts, STATE_TEXTS)).toEqual([])
  })

  test("are held to promise rules that each catch their own probe", () => {
    expect(PromiseWords.blindRules()).toEqual([])
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

describe("the promise scan", PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, () => {
  const root = mkdtempSync(join(tmpdir(), "promise-words-"))
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("flags the retired promises of the move panel and the read-only note and a new one in the host, and spares a state text", () => {
    plant(join(root, "editors"), {
      "core/views/call-links.ts":
        "export const call = (name: string) => `Not called yet: open called process ${name}`",
      "core/views/move-sources.ts":
        "export const source = (label: string) => `The token waits at the gateway ${label}; Pulse does not move it yet.`",
      "core/views/move-targets.ts":
        'export const target = "Pulse does not start multi-instance elements yet."',
      "host/notices.ts": 'export const boards = "Boards show variables in a later release."',
      "host-kit/connections/connection-builder.ts":
        'export const note = "Read-only. Pulse cannot change data on this engine yet."',
      "webview/screens/columns.tsx": "export const Columns = () => <p>Variable columns follow</p>",
    })
    expect(PromiseWords.scan(join(root, "editors"), STATE_TEXTS)).toEqual([
      'core/views/move-sources.ts:1:42: "The token waits at the gateway {value}; Pulse does not move it yet." promises a later feature (not … yet)',
      'core/views/move-targets.ts:1:23: "Pulse does not start multi-instance elements yet." promises a later feature (not … yet)',
      'host/notices.ts:1:23: "Boards show variables in a later release." promises a later feature (later)',
      'host-kit/connections/connection-builder.ts:1:21: "Read-only. Pulse cannot change data on this engine yet." promises a later feature (not … yet)',
      'webview/screens/columns.tsx:1:33: "Variable columns follow" promises a later feature (follows)',
    ])
  })

  test("reads a sentence across the dots of a name and one a value or an inline tag splits, and ends one at a block", () => {
    plant(join(root, "split"), {
      "host/auth.ts": 'export const auth = "Pulse does not read auth.type oauth yet."',
      "host/tokens.ts":
        'export const tokens = (count: number) => "Pulse does not move " + String(count) + " tokens yet."',
      "webview/screens/gateway.tsx": [
        "export const Gateway = (props: { label: string }) => <p>Pulse does not move tokens at {props.label} yet.</p>",
        "export const Columns = () => <p>Variable columns are not supported <b>yet</b>.</p>",
        "export const Called = (props: { name: string }) => <p>Not called yet: open called process <b>{props.name}</b></p>",
        "export const Empty = () => <div><p>No instance waits here</p><p>Retry it, yet again</p></div>",
      ].join("\n"),
    })
    expect(PromiseWords.scan(join(root, "split"), STATE_TEXTS)).toEqual([
      'host/auth.ts:1:21: "Pulse does not read auth.type oauth yet." promises a later feature (not … yet)',
      'host/tokens.ts:1:42: "Pulse does not move {value} tokens yet." promises a later feature (not … yet)',
      'webview/screens/gateway.tsx:1:54: "Pulse does not move tokens at {value} yet." promises a later feature (not … yet)',
      'webview/screens/gateway.tsx:2:30: "Variable columns are not supported yet." promises a later feature (not … yet)',
    ])
  })

  test("reads the shipped texts of a package both editors show and leaves its kit and its generated code aside", () => {
    plant(join(root, "contract"), {
      "model/move-reasons.ts": 'export const reason = "Pulse moves tokens in a later version."',
      "testing/laws.ts": 'export const law = "a stopped operation soon cancels nothing more"',
      "generated/routes.ts": 'export const route = "kept for a later release"',
    })
    expect(PromiseWords.scan(join(root, "contract"), STATE_TEXTS, NOT_SHIPPED)).toEqual([
      'model/move-reasons.ts:1:23: "Pulse moves tokens in a later version." promises a later feature (later)',
    ])
  })

  test("reads the texts of a manifest", () => {
    const manifest = {
      contributes: { commands: [{ title: "Pulse: Open board" }, { title: "Writes follow" }] },
    }
    expect(PromiseWords.findings(PromiseWords.jsonTexts(manifest, "package.json"), {})).toEqual([
      'package.json.contributes.commands[1].title: "Writes follow" promises a later feature (follows)',
    ])
  })

  test("flags an allowance that spares no promise word or no text", () => {
    const allowed = {
      "Not called yet": "a probe",
      "Refresh to try again.": "a probe",
      "Coming soon": "a probe",
    }
    expect(
      PromiseWords.allowanceFindings(["Not called yet: open called process"], allowed),
    ).toEqual([
      '"Refresh to try again.": spares no promise word (a probe)',
      '"Coming soon": unused allowance (a probe)',
    ])
  })
})
