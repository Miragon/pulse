import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"
import { isNpmPublished, isPublishedLibrary, publishedLibraries } from "./workspace-packages.mjs"

describe("workspace-packages", () => {
  it("publishes exactly the packages that are neither private nor an extension", () => {
    assert.equal(isNpmPublished({ name: "a" }), true)
    assert.equal(isNpmPublished({ name: "a", private: true }), false)
    assert.equal(isNpmPublished({ name: "pulse", engines: { vscode: "^1.101.0" } }), false)
    assert.equal(isNpmPublished({ name: "a", engines: { node: ">=22" } }), true)
  })

  it("counts a library published from packages/ only", () => {
    const lib = (dir, manifest) => isPublishedLibrary({ dir, manifest: { name: "x", ...manifest } })
    assert.equal(lib("packages/core/widget-shell", {}), true)
    assert.equal(lib("packages/connectors/engine/engine-client", {}), true)
    // The CLI is on npm, but no server imports an interface.
    assert.equal(lib("apps/cli", {}), false)
    assert.equal(lib("packages/core/widget-shell", { private: true }), false)
    assert.equal(lib("packages/core/x", { engines: { vscode: "^1.101.0" } }), false)
  })

  it("lists the repo's seven libraries, what test-template.sh packs and the mirror waits for", () => {
    const out = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/workspace-packages.mjs"), "libraries"],
      { encoding: "utf8" },
    )
    const rows = out
      .trim()
      .split("\n")
      .map((line) => line.split("\t"))
    assert.deepEqual(
      rows,
      publishedLibraries(REPO_ROOT).map(({ dir, manifest }) => [dir, manifest.name]),
    )
    assert.deepEqual(rows.map(([, name]) => name).sort(), [
      "@miragon/pulse-engine-client",
      "@miragon/pulse-engine-connector",
      "@miragon/pulse-engine-core",
      "@miragon/pulse-http",
      "@miragon/pulse-profile",
      "@miragon/pulse-ui",
      "@miragon/pulse-widget-shell",
    ])
    for (const [dir] of rows) assert.match(dir, /^packages\//)
  })
})
