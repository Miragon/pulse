// @ts-check
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import {
  CDN_SIBLING,
  packedSiblings,
  packFindings,
  relativeSpecifiers,
  tarballFindings,
  TEST_FILE,
  TSCONFIG_FILE,
} from "./pack-contents.mjs"

/** A connector's tarball as files → text: dist, the widgets' source and what it imports. */
const CONNECTOR = {
  "package.json": JSON.stringify({
    name: "@miragon/pulse-x-connector",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./widgets": "./src/widgets/index.ts",
    },
  }),
  "dist/index.js": 'export * from "./tools/index.js"\nexport { plugin } from "./plugin.js"',
  "dist/index.d.ts": 'export * from "./tools/index.js"',
  "dist/index.js.map": '{"version":3,"sources":["../src/index.ts"],"mappings":""}',
  "dist/index.d.ts.map": '{"version":3,"sources":["../src/index.ts"],"mappings":""}',
  "dist/plugin.js": "export const plugin = 1",
  "dist/tools/index.js": 'import { z } from "zod"\nexport const tools = []',
  "dist/tools/index.d.ts": "export declare const tools: unknown[]",
  "src/index.ts": "export const tools = []",
  "src/widgets/index.ts": [
    'export { Views } from "./views.js"',
    'import type { Model } from "../view-models.js"',
    'import { names } from "../messages/index.js"',
    'import "./styles.css"',
    'const lazy = () => import("./lazy")',
  ].join("\n"),
  "src/widgets/views.tsx": 'import { useT } from "../messages/use-t.js"\nexport const Views = {}',
  "src/widgets/lazy/index.tsx": "export default 1",
  "src/widgets/styles.css": ".a{}",
  "src/view-models.ts": "export type Model = {}",
  "src/messages/index.ts": "export const names = {}",
  "src/messages/use-t.ts": "export const useT = () => {}",
}

/**
 * A library with a browser bundle whose module imports a sibling library's from a CDN, as
 * widget-shell's claude-artifact.js imports pulse-ui.js: three levels up from dist/browser/ is the
 * scope, so the import lands on pulse-ui's file of that version.
 */
const RUNTIME_IMPORT = "../../../pulse-ui@0.32.0/dist/browser/pulse-ui.js"
const SHELL = {
  "package.json": JSON.stringify({ name: "@miragon/pulse-widget-shell", version: "0.32.0" }),
  "dist/browser/claude-artifact.js": `import { useState } from "${RUNTIME_IMPORT}"\nexport { useState }`,
}
/** The libraries packed beside it, as packedSiblings reads them. */
const RUNTIME = new Map([
  ["@miragon/pulse-ui", { version: "0.32.0", files: new Set(["dist/browser/pulse-ui.js"]) }],
])

/** packFindings over an in-memory tarball, beside the libraries packed with it. */
const findings = (files, siblings) =>
  packFindings({
    manifest: JSON.parse(files["package.json"]),
    files: Object.keys(files).sort(),
    read: (file) => files[file],
    siblings,
  })
const without = (files, ...drop) =>
  Object.fromEntries(Object.entries(files).filter(([file]) => !drop.includes(file)))

describe("pack-contents", () => {
  it("passes a tarball whose entries and relative imports are all inside", () => {
    assert.deepEqual(findings(CONNECTOR), [])
  })

  it("fails a test, a test support and a test-support directory, in dist or src", () => {
    const planted = {
      ...CONNECTOR,
      "dist/tools/index.test.js": "",
      "dist/tools/index.test.d.ts": "",
      "dist/tools/test-support/fake-engine.js": "",
      "src/widgets/views.test.tsx": 'import { Views } from "./views.js"',
      "src/widgets/render.test-support.tsx": "",
    }
    assert.deepEqual(findings(planted), [
      "dist/tools/index.test.d.ts: a test ships (exclude it in files)",
      "dist/tools/index.test.js: a test ships (exclude it in files)",
      "dist/tools/test-support/fake-engine.js: a test ships (exclude it in files)",
      "src/widgets/render.test-support.tsx: a test ships (exclude it in files)",
      "src/widgets/views.test.tsx: a test ships (exclude it in files)",
    ])
  })

  it("fails a tsconfig, the editor's nested one under src or a package's own", () => {
    const planted = {
      ...CONNECTOR,
      "src/widgets/tsconfig.json": '{ "extends": "../../tsconfig.widgets.json" }',
      "tsconfig.widgets.json": "{}",
      // Not a project file: a module that merely carries the word.
      "dist/tsconfig-paths.js": "export const paths = {}",
    }
    const why =
      "a tsconfig ships (exclude it in files): a host's Vite reads it for the package's " +
      "sources and fails on an extends target the tarball lacks"
    assert.deepEqual(findings(planted), [
      `src/widgets/tsconfig.json: ${why}`,
      `tsconfig.widgets.json: ${why}`,
    ])
  })

  it("fails a widget import the files list left behind", () => {
    assert.deepEqual(findings(without(CONNECTOR, "src/view-models.ts", "src/messages/use-t.ts")), [
      "src/widgets/index.ts: imports ../view-models.js, which the tarball lacks (add it to files)",
      "src/widgets/views.tsx: imports ../messages/use-t.js, which the tarball lacks (add it to files)",
    ])
    assert.deepEqual(findings(without(CONNECTOR, "src/widgets/lazy/index.tsx")), [
      "src/widgets/index.ts: imports ./lazy, which the tarball lacks (add it to files)",
    ])
  })

  it("fails a dist module or declaration whose relative import is missing", () => {
    assert.deepEqual(findings(without(CONNECTOR, "dist/plugin.js", "dist/tools/index.d.ts")), [
      "dist/index.d.ts: imports ./tools/index.js, which the tarball lacks (add it to files)",
      "dist/index.js: imports ./plugin.js, which the tarball lacks (add it to files)",
    ])
  })

  it("fails an exports target, main or types that is not in the tarball", () => {
    assert.deepEqual(findings(without(CONNECTOR, "src/widgets/index.ts", "dist/index.d.ts")), [
      "exports .: ./dist/index.d.ts is not in the tarball",
      "exports ./widgets: ./src/widgets/index.ts is not in the tarball",
      "types: dist/index.d.ts is not in the tarball",
    ])
  })

  it("reads an exports subpath literally: a wildcard names no file, so list each one", () => {
    const withSchema = (exports) => ({
      ...CONNECTOR,
      "package.json": JSON.stringify({ ...JSON.parse(CONNECTOR["package.json"]), exports }),
      "schema/pulse.schema.json": "{}",
    })
    const { exports } = JSON.parse(CONNECTOR["package.json"])
    assert.deepEqual(findings(withSchema({ ...exports, "./schema/*": "./schema/*" })), [
      "exports ./schema/*: ./schema/* is not in the tarball",
    ])
    const literal = { ...exports, "./schema/pulse.schema.json": "./schema/pulse.schema.json" }
    assert.deepEqual(findings(withSchema(literal)), [])
  })

  it("fails a JSON module a shipped module imports that the tarball lacks", () => {
    const planted = {
      ...CONNECTOR,
      "dist/testing/index.js": 'import fixtures from "./fixtures.json" with { type: "json" }',
    }
    assert.deepEqual(findings(planted), [
      "dist/testing/index.js: imports ./fixtures.json, which the tarball lacks (add it to files)",
    ])
    assert.deepEqual(findings({ ...planted, "dist/testing/fixtures.json": "[]" }), [])
  })

  it("fails once for the maps whose sources the tarball lacks, naming the first", () => {
    // A .d.ts.map sorts first, and inlineSources never fills one: the hint says to ship them.
    const why =
      "ship the sources (src in files; inlineSources fills a .js.map, never a .d.ts.map), else " +
      "a host's Vite warns once per module it loads and go-to-definition stops at the declaration"
    assert.deepEqual(findings(without(CONNECTOR, "src/index.ts")), [
      `dist/index.d.ts.map: points to ../src/index.ts, which the tarball lacks (and 1 more): ${why}`,
    ])
    // Above the package root, beside it under a name the root prefixes, or the build machine's
    // absolute path: none reaches a consumer, though each reads as the shipped src/index.ts to a
    // check that clamps `..` at the root or tests the root's prefix without its slash.
    for (const source of ["../../src/index.ts", "../../package-src/index.ts", "/src/index.ts"]) {
      const map = JSON.stringify({ version: 3, sources: [source], mappings: "" })
      assert.deepEqual(
        findings({ ...CONNECTOR, "dist/plugin.js.map": map }),
        [`dist/plugin.js.map: points to ${source}, which the tarball lacks: ${why}`],
        source,
      )
    }
  })

  it("passes a map source that ships, through its sourceRoot, or inlined as its content", () => {
    const passing = {
      ...CONNECTOR,
      "dist/plugin.js.map": '{"version":3,"sourceRoot":"../src","sources":["index.ts"]}',
      // inlineSources: the content travels in the map, the file need not ship.
      "dist/tools/index.js.map": JSON.stringify({
        version: 3,
        sources: ["../../src/tools/index.ts"],
        sourcesContent: ["export const tools = []"],
        mappings: "",
      }),
    }
    assert.deepEqual(findings(passing), [])
    // Content inlined for one source of two: the other still has to ship.
    const half = JSON.stringify({
      sources: ["../../src/a.ts", "../../src/b.ts"],
      sourcesContent: ["export const a = 1", null],
    })
    assert.match(
      findings({ ...CONNECTOR, "dist/tools/index.js.map": half }).join("\n"),
      /^dist\/tools\/index\.js\.map: points to \.\.\/\.\.\/src\/b\.ts, which the tarball lacks: /,
    )
  })

  it("fails a map that is no JSON object, and skips a test's map that already fails", () => {
    for (const text of ["not json", "null", "[]", "3"]) {
      assert.deepEqual(
        findings({ ...CONNECTOR, "dist/plugin.js.map": text }),
        ["dist/plugin.js.map: a map that is no JSON object ships"],
        text,
      )
    }
    assert.deepEqual(
      findings({ ...CONNECTOR, "dist/a.test.js.map": '{"sources":["../src/a.ts"]}' }),
      ["dist/a.test.js.map: a test ships (exclude it in files)"],
    )
  })

  it("passes a browser bundle's import of a sibling library packed beside it at that version", () => {
    assert.deepEqual(findings(SHELL, RUNTIME), [])
    assert.deepEqual(CDN_SIBLING.exec(RUNTIME_IMPORT)?.slice(1), [
      "pulse-ui",
      "0.32.0",
      "dist/browser/pulse-ui.js",
    ])
  })

  it("fails that import at another version, without the file, or without the library in the run", () => {
    const at = `dist/browser/claude-artifact.js: imports ${RUNTIME_IMPORT}, @miragon/pulse-ui's file beside it on a CDN`
    const older = new Map([
      ["@miragon/pulse-ui", { version: "0.31.0", files: new Set(["dist/browser/pulse-ui.js"]) }],
    ])
    assert.deepEqual(findings(SHELL, older), [
      `${at} at 0.32.0, but this run packs @miragon/pulse-ui 0.31.0: a page loads both by one version`,
    ])
    const without = new Map([
      ["@miragon/pulse-ui", { version: "0.32.0", files: new Set(["dist/browser/lucide.js"]) }],
    ])
    assert.deepEqual(findings(SHELL, without), [`${at}, which @miragon/pulse-ui's tarball lacks`])
    assert.deepEqual(findings(SHELL), [`${at}, but this run packs no @miragon/pulse-ui`])
  })

  it("holds every other escape to the tarball: deeper, from another folder, another library", () => {
    const lacks = (file, spec) =>
      `${file}: imports ${spec}, which the tarball lacks (add it to files)`
    for (const [file, spec] of [
      // One level more leaves the scope: nothing a page loads by name.
      ["dist/browser/claude-artifact.js", `../${RUNTIME_IMPORT}`],
      // From dist/ three levels up is the CDN's root, not the scope.
      ["dist/index.js", RUNTIME_IMPORT],
      ["dist/browser/nested/page.js", RUNTIME_IMPORT],
      // A library outside Pulse's, and a version that is no exact one.
      ["dist/browser/claude-artifact.js", "../../../react@19.3.1/dist/browser/react.js"],
      ["dist/browser/claude-artifact.js", "../../../pulse-ui@latest/dist/browser/pulse-ui.js"],
      ["dist/browser/claude-artifact.js", "../../../pulse-ui@0.32.0/dist/pulse-ui.js"],
    ]) {
      const planted = { ...SHELL, [file]: `import x from "${spec}"\nexport default x` }
      assert.deepEqual(findings(planted, RUNTIME), [lacks(file, spec)], `${file} ${spec}`)
    }
  })

  it("reads module specifiers from the AST, not from comments or strings", () => {
    const source = [
      '// import "./commented.js"',
      "const s = \"import x from './in-string.js'\"",
      'export * from "./star.js"',
      'type T = import("./type-only.js").T',
      'import pkg from "some-package"',
    ].join("\n")
    assert.deepEqual(relativeSpecifiers("a.ts", source), ["./star.js", "./type-only.js"])
  })

  it("names tests by file or directory, never a module that merely mentions one", () => {
    for (const file of ["a.test.ts", "x/a.test-support.tsx", "dist/test-support/b.js"]) {
      assert.ok(TEST_FILE.test(file), file)
    }
    for (const file of [
      "src/widgets/action-gating.sites.ts",
      "dist/testing/index.js",
      "latest.js",
    ]) {
      assert.ok(!TEST_FILE.test(file), file)
    }
  })

  it("names project files by their name, never a module or config that merely mentions one", () => {
    for (const file of ["tsconfig.json", "src/ui/tsconfig.json", "tsconfig.widgets.json"]) {
      assert.ok(TSCONFIG_FILE.test(file), file)
    }
    for (const file of ["dist/tsconfig-paths.js", "src/tsconfig.ts", "jsconfig.json"]) {
      assert.ok(!TSCONFIG_FILE.test(file), file)
    }
  })

  describe("a packed tarball", () => {
    const dirs = []
    after(() => {
      for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
    })

    /** A .tgz with `files` under package/, the way npm and pnpm pack. */
    function tarball(files) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-contents-test-"))
      dirs.push(dir)
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, "package", rel)), { recursive: true })
        fs.writeFileSync(path.join(dir, "package", rel), text)
      }
      const tgz = path.join(dir, "x.tgz")
      execFileSync("tar", ["-czf", tgz, "-C", dir, "package"])
      return tgz
    }

    it("resolves a CDN-sibling import in the library packed in the same run", () => {
      const runtime = tarball({
        "package.json": JSON.stringify({ name: "@miragon/pulse-ui", version: "0.32.0" }),
        "dist/browser/pulse-ui.js": "export const useState = () => {}",
      })
      const shell = tarball(SHELL)
      const siblings = packedSiblings([runtime, shell])
      assert.deepEqual([...siblings.keys()], ["@miragon/pulse-ui", "@miragon/pulse-widget-shell"])
      assert.deepEqual(siblings.get("@miragon/pulse-ui"), {
        version: "0.32.0",
        files: new Set(["package.json", "dist/browser/pulse-ui.js"]),
      })
      assert.deepEqual(tarballFindings(shell, siblings).findings, [])
      assert.equal(tarballFindings(shell).findings.length, 1)
    })

    it("reads the tarball the way npm unpacks it", () => {
      assert.deepEqual(tarballFindings(tarball(CONNECTOR)), {
        name: "@miragon/pulse-x-connector",
        files: Object.keys(CONNECTOR).length,
        findings: [],
      })
      const planted = tarballFindings(tarball({ ...CONNECTOR, "dist/a.test.js": "" }))
      assert.deepEqual(planted.findings, ["dist/a.test.js: a test ships (exclude it in files)"])
    })
  })
})
