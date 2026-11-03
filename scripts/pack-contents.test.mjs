import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { packFindings, relativeSpecifiers, tarballFindings, TEST_FILE } from "./pack-contents.mjs"

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
  "dist/index.js.map": '{"sources":["../src/index.ts"]}',
  "dist/plugin.js": "export const plugin = 1",
  "dist/tools/index.js": 'import { z } from "zod"\nexport const tools = []',
  "dist/tools/index.d.ts": "export declare const tools: unknown[]",
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

/** packFindings over an in-memory tarball. */
const findings = (files) =>
  packFindings({
    manifest: JSON.parse(files["package.json"]),
    files: Object.keys(files).sort(),
    read: (file) => files[file],
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
