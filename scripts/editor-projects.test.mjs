import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import {
  TEMPLATE_WORKSPACE,
  checkEditorProjects,
  checkWorkspace,
  workspaceGlobs,
} from "./check-package-scripts.mjs"
import {
  editorProjectFindings,
  extraTsconfigs,
  optionsKey,
  toPosix,
  treesOf,
} from "./editor-projects.mjs"
import { MUTATION_PAUSED } from "./mutation-pause.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * A connector the way the repo lays one out: tsconfig.json leaves the widgets out, and the
 * browser-only tsconfig.widgets.json (wired into `typecheck`) checks them.
 */
const CONNECTOR = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, types: ["node"], rootDir: "src", outDir: "dist" },
    include: ["src"],
    exclude: ["src/widgets"],
  }),
  "tsconfig.widgets.json": JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { jsx: "react-jsx", types: [], noEmit: true },
    include: ["src/widgets"],
    exclude: ["src/widgets/legacy"],
  }),
  "src/index.ts": "export {}\n",
  "src/widgets/view.tsx": "export const View = () => null\n",
  "src/widgets/lib/rows.ts": "export const rows = []\n",
  "src/widgets/legacy/old.ts": "export {}\n",
  // The editor's project for the widgets: extends the gate's, sets only include. The legacy tree
  // tsconfig.widgets.json leaves out stays out through the inherited exclude.
  "src/widgets/tsconfig.json": JSON.stringify({
    extends: "../../tsconfig.widgets.json",
    include: ["."],
  }),
}

/** A VS Code-style app: the union tsconfig.json leaves one probe out for its layer's project. */
const LAYERED = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, types: [] },
    include: ["src", "test"],
    exclude: ["test/*/probe.ts"],
  }),
  "tsconfig.core.json": JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { lib: ["ES2023"] },
    include: ["src/core", "test/core"],
    exclude: [],
  }),
  "src/core/a.ts": "export {}\n",
  "test/core/a.test.ts": "export {}\n",
  "test/core/probe.ts": "export {}\n",
  "test/core/tsconfig.json": JSON.stringify({
    extends: "../../tsconfig.core.json",
    include: ["probe.ts"],
  }),
}

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** The findings for `files` (path → text, null drops a file) laid out under a fresh package. */
function findings(files) {
  const root = mkdtempSync(path.join(tmpdir(), "editor-projects-"))
  roots.push(root)
  const pkg = path.join(root, "pkg")
  for (const [file, text] of Object.entries(files)) {
    if (text === null) continue
    mkdirSync(path.dirname(path.join(pkg, file)), { recursive: true })
    writeFileSync(path.join(pkg, file), text)
  }
  return editorProjectFindings(ts, pkg, "pkg")
}

describe("editorProjectFindings over fixture packages", () => {
  it("passes a package whose extra-only tree carries a nested tsconfig.json extending its project", () => {
    assert.deepEqual(findings(CONNECTOR), [])
  })

  it("passes a nested tsconfig.json that owns one file, leaving its siblings to the union", () => {
    assert.deepEqual(findings(LAYERED), [])
  })

  it("flags the tree an editor opens in an inferred project and names the file to add", () => {
    assert.deepEqual(findings({ ...CONNECTOR, "src/widgets/tsconfig.json": null }), [
      "pkg/src/widgets: 2 file(s) only tsconfig.widgets.json checks open in an inferred " +
        "project in editors (no strict, no react-jsx, the wrong globals): no tsconfig.json above " +
        'them includes them. Add pkg/src/widgets/tsconfig.json with { "extends": ' +
        '"../../tsconfig.widgets.json", "include": ["."] }',
    ])
  })

  it("flags a nested tsconfig.json whose compiler options differ from the gate's project", () => {
    const loose = JSON.stringify({
      extends: "../../tsconfig.widgets.json",
      compilerOptions: { strict: false },
      include: ["."],
    })
    assert.deepEqual(findings({ ...CONNECTOR, "src/widgets/tsconfig.json": loose }), [
      "pkg/src/widgets/view.tsx (and 1 more): editors open it in pkg/src/widgets/tsconfig.json, " +
        "whose compiler options differ from tsconfig.widgets.json, which checks it; extend that " +
        "project and set only include and exclude",
    ])
  })

  it("flags a nested tsconfig.json that includes what the gate's project leaves out", () => {
    const wide = JSON.stringify({
      extends: "../../tsconfig.widgets.json",
      include: ["."],
      exclude: [],
    })
    assert.deepEqual(findings({ ...CONNECTOR, "src/widgets/tsconfig.json": wide }), [
      "pkg/src/widgets/tsconfig.json: includes pkg/src/widgets/legacy/old.ts, which " +
        "tsconfig.widgets.json leaves out, so editors report what no gate reports; include only " +
        "that project's files",
    ])
  })

  it("flags a nested tsconfig.json that takes files from the package's tsconfig.json", () => {
    const greedy = JSON.stringify({ extends: "../../tsconfig.core.json", include: ["."] })
    assert.deepEqual(findings({ ...LAYERED, "test/core/tsconfig.json": greedy }), [
      "pkg/test/core/a.test.ts: in pkg/tsconfig.json, but editors and typescript-eslint open it " +
        "in pkg/test/core/tsconfig.json; a nested tsconfig.json includes only files tsconfig.json " +
        "leaves out",
    ])
  })

  it("flags a nested tsconfig.json that does not parse, e.g. a stale extends", () => {
    const stale = JSON.stringify({ extends: "../../tsconfig.gone.json", include: ["."] })
    const found = findings({ ...CONNECTOR, "src/widgets/tsconfig.json": stale })
    assert.ok(
      found.some((f) => /^pkg\/src\/widgets\/tsconfig\.json: .*tsconfig\.gone\.json/.test(f)),
      found.join("\n"),
    )
  })

  it("compares compiler options at every depth, e.g. a plugin swapped for another", () => {
    const withPlugin = (name, extra) => ({
      ...extra,
      compilerOptions: { ...extra.compilerOptions, plugins: [{ name, options: { a: 1 } }] },
    })
    const widgets = JSON.parse(CONNECTOR["tsconfig.widgets.json"])
    const nested = JSON.parse(CONNECTOR["src/widgets/tsconfig.json"])
    const files = {
      ...CONNECTOR,
      "tsconfig.widgets.json": JSON.stringify(withPlugin("a", widgets)),
      "src/widgets/tsconfig.json": JSON.stringify(withPlugin("b", nested)),
    }
    assert.deepEqual(findings(files), [
      "pkg/src/widgets/view.tsx (and 1 more): editors open it in pkg/src/widgets/tsconfig.json, " +
        "whose compiler options differ from tsconfig.widgets.json, which checks it; extend that " +
        "project and set only include and exclude",
    ])
  })

  it("flags a nested tsconfig.json with options of its own over a tree no project checks", () => {
    const scratch = {
      ...CONNECTOR,
      "tsconfig.json": JSON.stringify({
        ...JSON.parse(CONNECTOR["tsconfig.json"]),
        exclude: ["src/widgets", "src/scratch"],
      }),
      "src/scratch/a.ts": "export {}\n",
      "src/scratch/tsconfig.json": JSON.stringify({
        compilerOptions: { strict: false },
        include: ["."],
      }),
    }
    assert.deepEqual(findings(scratch), [
      "pkg/src/scratch/tsconfig.json: includes pkg/src/scratch/a.ts, which no project of the " +
        "package checks, with compiler options no tsconfig.<x>.json of it has, so editors report " +
        "what no gate reports; check them in a tsconfig.<x>.json and extend that, setting only " +
        "include and exclude",
    ])
  })

  it("names the probe, not the tree, when its directory also holds files of tsconfig.json", () => {
    assert.deepEqual(findings({ ...LAYERED, "test/core/tsconfig.json": null }), [
      "pkg/test/core: 1 file(s) only tsconfig.core.json checks open in an inferred project in " +
        "editors (no strict, no react-jsx, the wrong globals): no tsconfig.json above them " +
        'includes them. Add pkg/test/core/tsconfig.json with { "extends": ' +
        '"../../tsconfig.core.json", "include": ["probe.ts"] }',
    ])
  })

  it("never advises a nested config at the package root, where tsconfig.json is the package's", () => {
    const root = {
      "tsconfig.json": JSON.stringify({ include: ["src"] }),
      "tsconfig.node.json": JSON.stringify({ include: ["vite.config.ts"] }),
      "src/a.ts": "export {}\n",
      "vite.config.ts": "export default {}\n",
    }
    assert.deepEqual(findings(root), [
      "pkg: 1 file(s) only tsconfig.node.json checks open in an inferred project in editors " +
        "(no strict, no react-jsx, the wrong globals): no tsconfig.json above them includes " +
        "them. Add them to pkg/tsconfig.json, or move them into a directory of their own with a " +
        "nested tsconfig.json that extends tsconfig.node.json",
    ])
  })

  it("checks nothing a package without extra projects does not have", () => {
    assert.deepEqual(
      findings({ "tsconfig.json": JSON.stringify({ include: ["src"] }), "src/a.ts": "" }),
      [],
    )
  })
})

describe("optionsKey", () => {
  it("ignores key order and the config path, at every depth", () => {
    assert.equal(
      optionsKey({ configFilePath: "/a/tsconfig.json", strict: true, plugins: [{ b: 1, a: 2 }] }),
      optionsKey({ plugins: [{ a: 2, b: 1 }], strict: true, configFilePath: "/b/tsconfig.json" }),
    )
    assert.notEqual(
      optionsKey({ plugins: [{ name: "a" }] }),
      optionsKey({ plugins: [{ name: "b" }] }),
    )
  })
})

describe("toPosix", () => {
  it("spells a Windows path the way TypeScript returns it", () => {
    assert.equal(toPosix("C:\\repo\\packages\\core\\ui", "\\"), "C:/repo/packages/core/ui")
    assert.equal(toPosix("/repo/packages/core/ui", "/"), "/repo/packages/core/ui")
  })
})

describe("treesOf", () => {
  it("folds each directory into its topmost listed parent", () => {
    assert.deepEqual(
      treesOf(["src/ui/a.ts", "src/ui/lib/b.ts", "test/c.ts", "test-host/d.ts", "src/uix/e.ts"]),
      ["src/ui", "src/uix", "test", "test-host"],
    )
    assert.deepEqual(treesOf(["a.ts", "lib/b.ts"]), ["."])
  })
})

describe("the real repo", () => {
  const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
  const { sourceDirs } = checkWorkspace(repoRoot, globs, { mutationPaused: MUTATION_PAUSED })

  it("opens every file of every workspace and template package with its gate's settings", () => {
    assert.deepEqual(checkEditorProjects(ts, repoRoot, sourceDirs), [])
  })

  it("is not blind: without its nested tsconfig.json a widget tree is a finding", () => {
    const hidden = path.join(repoRoot, "packages/connectors/engine/engine-connector/src/widgets")
    const gone = path.join(hidden, "tsconfig.json")
    const sys = {
      ...ts.sys,
      fileExists: (file) => file !== gone && ts.sys.fileExists(file),
      readDirectory: (...args) => ts.sys.readDirectory(...args).filter((file) => file !== gone),
    }
    const dir = "packages/connectors/engine/engine-connector"
    const found = editorProjectFindings({ ...ts, sys }, path.join(repoRoot, dir), dir)
    assert.equal(found.length, 1, found.join("\n"))
    assert.match(
      found[0],
      /^packages\/connectors\/engine\/engine-connector\/src\/widgets: \d+ file/,
    )
  })

  it("covers every package with an extra project, and the template's", () => {
    const template = ["modules/mcp-notes", "server"].map((dir) =>
      path.posix.join(TEMPLATE_WORKSPACE, dir),
    )
    for (const dir of [...sourceDirs, ...template]) {
      if (extraTsconfigs(path.join(repoRoot, dir)).length === 0) continue
      assert.deepEqual(editorProjectFindings(ts, path.join(repoRoot, dir), dir), [], dir)
    }
    assert.ok(sourceDirs.includes("apps/mcp-server") && sourceDirs.includes("apps/vscode"))
  })
})
