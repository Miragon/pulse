import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { checkWorkspace, workspaceGlobs } from "./check-package-scripts.mjs"
import { MUTATION_PAUSED } from "./mutation-pause.mjs"
import {
  MODULE_SYNTAX_EXEMPT,
  checkModuleSyntax,
  missingOptions,
  moduleSyntaxFindings,
  programsOf,
} from "./module-syntax.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const BOTH = { verbatimModuleSyntax: true, isolatedModules: true }

/**
 * A library the way the repo lays one out: tsconfig.json sets both options, the widgets' project
 * and its nested editor project inherit them, and so do the tests' through a shared base.
 */
const LIBRARY = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, outDir: "dist", ...BOTH },
    include: ["src"],
    exclude: ["src/widgets"],
  }),
  "tsconfig.widgets.json": JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { jsx: "react-jsx", noEmit: true },
    include: ["src/widgets"],
    exclude: [],
  }),
  "src/index.ts": "export {}\n",
  "src/widgets/view.tsx": "export const View = () => null\n",
  "src/widgets/tsconfig.json": JSON.stringify({
    extends: "../../tsconfig.widgets.json",
    include: ["."],
  }),
}

const LIBRARY_FILES = [
  "pkg/src/widgets/tsconfig.json",
  "pkg/tsconfig.json",
  "pkg/tsconfig.widgets.json",
]

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A fresh root with `files` (path → text, null drops a file) under `pkg`; returns the root. */
function fixture(files, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "module-syntax-"))
  roots.push(root)
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  for (const [file, text] of Object.entries(files)) if (text !== null) write(`pkg/${file}`, text)
  for (const [file, text] of Object.entries(extra)) write(file, text)
  return root
}

const findings = (files, options) =>
  moduleSyntaxFindings(ts, path.join(fixture(files), "pkg"), "pkg", options)

const missing = (file, options) =>
  `${file}: does not set ${options.map((option) => `"${option}": true`).join(" and ")} ` +
  `(itself or through extends), so tsc drops a type re-exported without \`type\` from dist ` +
  `while vitest keeps the name with the value undefined; set both in compilerOptions`

describe("moduleSyntaxFindings over fixture packages", () => {
  it("reads every program: tsconfig.json, each tsconfig.<x>.json and the nested editor projects", () => {
    const root = fixture(LIBRARY)
    const programs = programsOf(ts, path.join(root, "pkg")).map((configPath) =>
      path.posix.relative(root.split(path.sep).join("/"), configPath),
    )
    assert.deepEqual(programs, LIBRARY_FILES)
  })

  it("passes a package whose programs set both options, inherited through extends", () => {
    assert.deepEqual(findings(LIBRARY), [])
  })

  it("flags the package's tsconfig.json and every program that extends it once an option is gone", () => {
    const loose = JSON.stringify({
      compilerOptions: { strict: true, isolatedModules: true },
      include: ["src"],
      exclude: ["src/widgets"],
    })
    assert.deepEqual(
      findings({ ...LIBRARY, "tsconfig.json": loose }),
      LIBRARY_FILES.map((file) => missing(file, ["verbatimModuleSyntax"])),
    )
  })

  it("flags an extra project that turns an option off", () => {
    const off = JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { jsx: "react-jsx", isolatedModules: false },
      include: ["src/widgets"],
    })
    assert.deepEqual(findings({ ...LIBRARY, "tsconfig.widgets.json": off }), [
      missing("pkg/src/widgets/tsconfig.json", ["isolatedModules"]),
      missing("pkg/tsconfig.widgets.json", ["isolatedModules"]),
    ])
  })

  it("flags a nested tsconfig.json that extends no program of the package", () => {
    const alone = JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, include: ["."] })
    assert.deepEqual(findings({ ...LIBRARY, "src/widgets/tsconfig.json": alone }), [
      missing("pkg/src/widgets/tsconfig.json", ["verbatimModuleSyntax", "isolatedModules"]),
    ])
  })

  it("resolves a base outside the package", () => {
    const root = fixture(
      {
        "tsconfig.json": JSON.stringify({ extends: "../tsconfig.base.json", include: ["src"] }),
        "src/index.ts": "export {}\n",
      },
      { "tsconfig.base.json": JSON.stringify({ compilerOptions: BOTH }) },
    )
    assert.deepEqual(missingOptions(ts, path.join(root, "pkg/tsconfig.json")), [])
  })

  it("leaves an exempt package alone, and fails its entry once it sets both everywhere", () => {
    const bare = JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] })
    const exempt = { exempt: { pkg: "the fixture's reason" } }
    assert.deepEqual(findings({ "tsconfig.json": bare, "src/index.ts": "export {}\n" }, exempt), [])
    assert.deepEqual(findings(LIBRARY, exempt), [
      "pkg: sets verbatimModuleSyntax and isolatedModules in every program, so its " +
        "MODULE_SYNTAX_EXEMPT entry in scripts/module-syntax.mjs is stale; remove it",
    ])
  })

  it("fails an exempt entry that names no source package", () => {
    const root = fixture(LIBRARY)
    assert.deepEqual(
      checkModuleSyntax(ts, root, ["pkg"], { exempt: { "apps/gone": "a reason" } }),
      [
        'MODULE_SYNTAX_EXEMPT in scripts/module-syntax.mjs: "apps/gone" is not a workspace ' +
          "package with src/ (gone or renamed); move the entry to the package's new dir or remove it",
      ],
    )
  })
})

describe("the real repo", () => {
  const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
  const { sourceDirs } = checkWorkspace(repoRoot, globs, { mutationPaused: MUTATION_PAUSED })

  it("every program of every source package sets both options, the exempt server app aside", () => {
    assert.deepEqual(checkModuleSyntax(ts, repoRoot, sourceDirs), [])
  })

  it("the four libraries that took both options last are held, every program of them", () => {
    for (const dir of [
      "packages/core/ui",
      "packages/core/widget-shell",
      "packages/connectors/c7/c7-client",
      "packages/connectors/engine/engine-connector",
    ]) {
      assert.ok(!Object.hasOwn(MODULE_SYNTAX_EXEMPT, dir), dir)
      const programs = programsOf(ts, path.join(repoRoot, dir))
      assert.ok(programs.length > 0, dir)
      for (const configPath of programs)
        assert.deepEqual(missingOptions(ts, configPath), [], configPath)
    }
  })

  it("exempts the server app alone, with its reason", () => {
    assert.deepEqual(Object.keys(MODULE_SYNTAX_EXEMPT), ["apps/mcp-server"])
    assert.ok(MODULE_SYNTAX_EXEMPT["apps/mcp-server"].includes("publishes no entry"))
  })
})
