import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "node:test"
import { APP_SCAN, scanSources, unclassifiedApps } from "./source-scan.mjs"

/** Which sources the cross-module guards read (source-scan.mjs), over temp-tree fixtures. */

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A temp repo from a { relPath: text } map. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-scan-"))
  roots.push(root)
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  return root
}

const json = (value) => JSON.stringify(value)

/** A server app and two packages, with files every scan must skip. */
const BASE = {
  "apps/mcp-server-camunda7/package.json": json({
    name: "@miragon/pulse-mcp-server-camunda7",
    private: true,
  }),
  "apps/mcp-server-camunda7/src/a.ts": "a",
  "packages/core/widget-shell/src/b.ts": "b",
  "packages/core/widget-shell/src/ui/inline-fit.test-support.tsx": "support tsx",
  "packages/core/widget-shell/src/ui/styles.css": "css",
  "packages/core/no-src/package.json": json({ name: "@miragon/pulse-no-src" }),
  "packages/connectors/camunda/camunda7-connector/src/c.ts": "c",
  "packages/connectors/camunda/camunda7-connector/src/routes.mts": "mts",
  "packages/connectors/camunda/camunda7-connector/src/c.test.ts": "test",
  "packages/connectors/camunda/camunda7-connector/src/c.test.tsx": "test tsx",
  "packages/connectors/camunda/camunda7-connector/src/labels.test-support.ts": "support",
  "packages/connectors/camunda/camunda7-connector/src/generated/g.ts": "generated",
  "packages/connectors/camunda/camunda7-connector/src/notes.md": "md",
}

const BASE_FILES = [
  "apps/mcp-server-camunda7/src/a.ts",
  "packages/connectors/camunda/camunda7-connector/src/c.ts",
  "packages/connectors/camunda/camunda7-connector/src/routes.mts",
  "packages/core/widget-shell/src/b.ts",
  "packages/core/widget-shell/src/ui/inline-fit.test-support.tsx",
]

const INTERFACES = {
  "apps/cli/package.json": json({ name: "@miragon/pulse-cli", bin: { "pulse-cli": "dist/x.js" } }),
  "apps/cli/src/index.ts": "cli",
  "apps/vscode/package.json": json({ name: "pulse", engines: { vscode: "^1.101.0" } }),
  "apps/vscode/src/host/extension.ts": "extension",
}

const CLASSIFIED = { "mcp-server-camunda7": "mcp-host", cli: "interface", vscode: "interface" }

const filesIn = (root, apps) => scanSources((file) => [file], { root, apps }).sort()

describe("scanSources", () => {
  it("reads every package and the MCP server apps, skipping tests, .test-support.ts and generated code", () => {
    const root = fixture(BASE)
    assert.deepEqual(filesIn(root, { "mcp-server-camunda7": "mcp-host" }), BASE_FILES)
    // The scan gets the repo-relative path and the file's text.
    const first = scanSources((file, text) => [`${file}=${text}`], {
      root,
      apps: { "mcp-server-camunda7": "mcp-host" },
    }).sort()[0]
    assert.equal(first, "apps/mcp-server-camunda7/src/a.ts=a")
  })

  it("never reads an interface app, and tells each scan what a file belongs to", () => {
    const root = fixture({ ...BASE, ...INTERFACES })
    assert.deepEqual(filesIn(root, CLASSIFIED), BASE_FILES)
    const owners = scanSources((file, _text, owner) => [`${file} ${owner}`], {
      root,
      apps: CLASSIFIED,
    })
    assert.deepEqual(owners.sort(), [
      "apps/mcp-server-camunda7/src/a.ts mcp-host",
      "packages/connectors/camunda/camunda7-connector/src/c.ts package",
      "packages/connectors/camunda/camunda7-connector/src/routes.mts package",
      "packages/core/widget-shell/src/b.ts package",
      "packages/core/widget-shell/src/ui/inline-fit.test-support.tsx package",
    ])
  })

  it("reads a second MCP server app too", () => {
    const root = fixture({
      ...BASE,
      "apps/other-server/package.json": json({ name: "x" }),
      "apps/other-server/src/s.ts": "s",
    })
    const apps = { "mcp-server-camunda7": "mcp-host", "other-server": "mcp-host" }
    assert.deepEqual(filesIn(root, apps), [...BASE_FILES, "apps/other-server/src/s.ts"].sort())
  })
})

describe("unclassifiedApps", () => {
  it("names an app APP_SCAN does not classify, and nothing else", () => {
    const root = fixture({
      ...BASE,
      ...INTERFACES,
      "apps/mcp-server-flowable/package.json": json({ name: "y" }),
      "apps/mcp-server-flowable/src/a.ts": "a",
      // A leftover without a manifest is no app.
      "apps/leftover/node_modules/x/index.js": "",
    })
    assert.deepEqual(unclassifiedApps(root, CLASSIFIED), ["mcp-server-flowable"])
    assert.deepEqual(
      unclassifiedApps(root, { ...CLASSIFIED, "mcp-server-flowable": "mcp-host" }),
      [],
    )
  })
})

describe("the repo's apps", () => {
  it("are each classified in APP_SCAN, so none falls out of the source guards unnoticed", () => {
    assert.deepEqual(unclassifiedApps(), [])
  })

  it("are read by the scan (the scanner is not blind)", () => {
    const files = scanSources((file) => [file])
    for (const file of [
      "apps/mcp-server-camunda7/src/index.ts",
      "packages/core/widget-shell/src/caller.ts",
      "packages/connectors/camunda/camunda7-connector/src/module.ts",
    ]) {
      assert.ok(files.includes(file), file)
    }
    assert.equal(
      files.some((file) => /\.test\.tsx?$|\/generated\//.test(file)),
      false,
    )
    assert.equal(
      files.some((file) => file.startsWith("apps/cli/") || file.startsWith("apps/vscode/")),
      false,
    )
    assert.equal(APP_SCAN["mcp-server-camunda7"], "mcp-host")
  })
})
