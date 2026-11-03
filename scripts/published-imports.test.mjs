import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { builtinModules } from "node:module"
import { afterEach, describe, it } from "node:test"
import ts from "typescript"
import { isNpmPublished, readWorkspace } from "./workspace-packages.mjs"
import { ratchetKind } from "./check-ratchets.mjs"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * A package published to npm imports from its shipped source only what its
 * manifest makes the consumer install: `dependencies` or `peerDependencies`
 * (#345, N176). knip's unlisted check counts `devDependencies` as listed, so a
 * widget that imports a dev-only package builds here and breaks in a consumer
 * that does not happen to hoist it.
 *
 * Published to npm means: a workspace package (every glob of
 * pnpm-workspace.yaml, apps/* included) whose manifest is not `"private":
 * true` and declares no `engines.vscode`. A VS Code extension ships as a .vsix
 * (vsce/ovsx), never through npm, and the private apps (the server) ship as
 * an image; neither is read here.
 *
 * An app that BUNDLES workspace packages it lists only as devDependencies
 * would fail the src scan by design, so a bundled app (BUNDLED_APPS: the CLI,
 * which bundles @miragon/pulse-engine-core) is read from its BUILT bundle
 * instead: every module under its dist imports only Node built-ins and its
 * declared dependencies (a workspace package left external fails), and the
 * bundle stays within its size budget and close to it. `pnpm build` runs first (CI's
 * TypeScript job and the minimum bar build before `pnpm test`).
 */

/**
 * Apps read from their built bundle: the directory, and the budget file whose `dist` key is the
 * size budget in bytes of every module under it (set to the measured size rounded up to the next
 * 16 KiB). The budget file is a shrink-only ratchet (scripts/check-ratchets.mjs, like the widget
 * bundle's and the webview's): a raise needs a Ratchet-Exception trailer that says why, and a
 * bundle that shrank more than 10 % below its budget lowers it (BUDGET_TIGHT, as the widget
 * bundle's spec does), so the headroom never silently piles up.
 */
const BUNDLED_APPS = {
  "@miragon/pulse-cli": {
    dist: "apps/cli/dist",
    budget: "apps/cli/test/__golden__/bundle-budget.json",
  },
}

/** Below this share of its budget a bundle lowers the budget. */
const BUDGET_TIGHT = 0.9
/** A budget is set to the measured size rounded up to the next multiple of this. */
const BUDGET_STEP = 16 * 1024

/** The size budget in bytes a bundled app's budget file holds (its `dist` key); throws without one. */
function bundleBudget(root, bundled) {
  const file = path.join(root, bundled.budget)
  if (!fs.existsSync(file))
    throw new Error(`${bundled.budget} is missing: the bundle has no budget`)
  const maxBytes = JSON.parse(fs.readFileSync(file, "utf8")).dist
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`${bundled.budget} holds no ceiling: "dist" must be a positive byte count`)
  }
  return maxBytes
}

/**
 * Every workspace package of the repo at `root` (workspace-packages.mjs's reader, which fails on a
 * workspace without globs), its directory absolute.
 * @returns {{ dir: string, manifest: Record<string, any> }[]}
 */
const workspacePackages = (root = REPO_ROOT) =>
  readWorkspace(root).map(({ dir, manifest }) => ({ dir: path.join(root, dir), manifest }))

/** Published to npm: not `"private": true`, and no VS Code extension (engines.vscode). */
const publishedPackages = (root = REPO_ROOT) =>
  workspacePackages(root).filter(({ manifest }) => isNpmPublished(manifest))

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const TEST_SOURCE = /\.test(?:-support)?\.(?:[cm]?[jt]s|[jt]sx)$/

// Shipped means every source a consumer receives, the generated SDK included
// (its imports are the client's own `dependencies`), minus tests and test
// support.
const isShipped = (rel) =>
  SOURCE.test(rel) &&
  !TEST_SOURCE.test(rel) &&
  !rel.split(path.sep).some((part) => part === "test-support")

/** What an import whose specifier is computed at runtime reads as: it cannot be checked. */
const NON_LITERAL = "<non-literal import>"

/**
 * Every module specifier `source` names, read from the TypeScript AST (so a
 * comment or a string that looks like an import is none): import and export
 * declarations (`export * as ns` included), `import x = require(…)`,
 * `import(…)`, `require(…)` and `import("…")` types, in either quote style.
 * A computed `import()`/`require()` argument reads as NON_LITERAL.
 */
function moduleSpecifiers(file, source) {
  const specifiers = []
  const literal = (node) =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : NON_LITERAL
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifiers.push(literal(node.moduleSpecifier))
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      specifiers.push(literal(node.moduleReference.expression))
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(literal(node.arguments[0]))
    } else if (ts.isImportTypeNode(node)) {
      specifiers.push(
        ts.isLiteralTypeNode(node.argument) ? literal(node.argument.literal) : NON_LITERAL,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
  return specifiers
}

/** The bare package names a module imports (relative paths and Node built-ins dropped). */
function importedPackages(file, source) {
  return moduleSpecifiers(file, source)
    .filter(
      (spec) =>
        !spec.startsWith(".") && !spec.startsWith("node:") && !builtinModules.includes(spec),
    )
    .map((spec) =>
      spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/"),
    )
}

const BUNDLE_SOURCE = /\.(?:[cm]?js)$/

/** The bundle of a bundled app: `file: package` imports it does not declare, and its size. */
function bundleFindings(root, { manifest }, bundled) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const dist = path.join(root, bundled.dist)
  if (!fs.existsSync(dist)) return [`${bundled.dist} is missing: run pnpm build first`]
  const files = fs
    .readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((rel) => BUNDLE_SOURCE.test(rel))
  const undeclared = files.flatMap((rel) =>
    importedPackages(rel, fs.readFileSync(path.join(dist, rel), "utf8"))
      .filter((name) => !declared.has(name))
      .map((name) => `${rel}: ${name}`),
  )
  const bytes = files.reduce((sum, rel) => sum + fs.statSync(path.join(dist, rel)).size, 0)
  const maxBytes = bundleBudget(root, bundled)
  const size =
    bytes > maxBytes
      ? [`${bundled.dist}: ${bytes} bytes, over the budget of ${maxBytes}`]
      : bytes < Math.floor(maxBytes * BUDGET_TIGHT)
        ? [
            `${bundled.dist}: ${bytes} bytes, more than 10 % below the budget of ${maxBytes}: lower "dist" in ${bundled.budget} to ${Math.ceil(bytes / BUDGET_STEP) * BUDGET_STEP}`,
          ]
        : []
  return [...new Set(undeclared)].sort().concat(size)
}

/** Each `file: package` a published package's src imports without declaring it. */
function undeclaredImports({ dir, manifest }) {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const src = path.join(dir, "src")
  if (!fs.existsSync(src)) {
    return [`src/: missing (a published package's shipped source is read from ${src})`]
  }
  const undeclared = fs
    .readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter(isShipped)
    .flatMap((rel) =>
      importedPackages(rel, fs.readFileSync(path.join(src, rel), "utf8"))
        .filter((name) => !declared.has(name))
        .map((name) => `${rel}: ${name}`),
    )
  return [...new Set(undeclared)].sort()
}

describe("published packages declare what their shipped source imports", () => {
  it("reads imports, not comments", () => {
    const source = [
      '// import { x } from "commented-out"',
      "/* a block naming",
      ' from "also-commented" */',
      'import type { A } from "@scope/types/sub"',
      "import {",
      "  b,",
      '} from "multi-line"',
      'export { c } from "re-exported"',
      'import "side-effect/style.css"',
      'const lazy = () => import("lazy-loaded")',
      'import { d } from "./local.js"',
      'import fs from "node:fs"',
      'import path from "path"',
    ].join("\n")
    assert.deepEqual(
      importedPackages("x.ts", source).sort(),
      ["@scope/types", "lazy-loaded", "multi-line", "re-exported", "side-effect"].sort(),
    )
  })

  it("reads every import form in either quote style", () => {
    const source = [
      "import { Command } from 'commander'",
      "export * from 're-star'",
      "export * as ns from 'ns-star'",
      "export { e } from '@scope/re-single/deep'",
      "import 'side-single'",
      "await import('dyn-single')",
      'await import("dyn-opts", { with: { type: "json" } })',
      "await import(`dyn-template`)",
      "import eq = require('import-equals')",
      "const r = require('plain-require')",
      "type T = import('type-import').Foo",
      "foo(); import j from 'after-statement'",
      "export { local }",
      "import Alias = Namespace.Member",
    ].join("\n")
    assert.deepEqual(
      importedPackages("x.ts", source).sort(),
      [
        "@scope/re-single",
        "after-statement",
        "commander",
        "dyn-opts",
        "dyn-single",
        "dyn-template",
        "import-equals",
        "ns-star",
        "plain-require",
        "re-star",
        "side-single",
        "type-import",
      ].sort(),
    )
  })

  it("reads a computed import() or require() as one it cannot check", () => {
    const source = [
      "await import(name)",
      "await import(`dyn-${name}`)",
      "require(name)",
      "require()",
    ].join("\n")
    assert.deepEqual(importedPackages("x.ts", source), [
      NON_LITERAL,
      NON_LITERAL,
      NON_LITERAL,
      NON_LITERAL,
    ])
  })

  it("ignores comments, strings, relative paths and Node built-ins", () => {
    const source = [
      "foo() /* import h from 'in-block-comment' */",
      "const s = \"import i from 'in-string'\"",
      "const t = `require('in-template')`",
      "import data from './data.json' with { type: 'json' }",
      "import { readFile } from 'node:fs'",
      "import { writeFile } from 'fs/promises'",
      "import path from 'path'",
      "const lib = require.resolve('resolved-only')",
      "obj.require('method-call')",
    ].join("\n")
    assert.deepEqual(importedPackages("x.ts", source), [])
  })

  it("parses JSX and plain JS modules by their extension", () => {
    assert.deepEqual(importedPackages("x.tsx", "import 'react'\nconst a = <div>{x}</div>"), [
      "react",
    ])
    assert.deepEqual(importedPackages("x.cjs", "const c = require('cjs-dep')"), ["cjs-dep"])
    assert.deepEqual(importedPackages("x.mjs", "import m from 'mjs-dep'"), ["mjs-dep"])
  })

  it("ships every TS and JS module but tests and test support", () => {
    const shipped = ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.d.ts"]
    assert.deepEqual(shipped.filter(isShipped), shipped)
    assert.deepEqual(
      [
        "a.test.ts",
        "a.test.tsx",
        "a.test.mts",
        "a.test.js",
        "a.test-support.ts",
        "a.test-support.tsx",
        "a.test-support.mjs",
        path.join("test-support", "b.ts"),
        "styles.css",
        "GLOSSARY.md",
        "data.json",
      ].filter(isShipped),
      [],
    )
  })

  describe("which packages it reads", () => {
    const roots = []
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
    })

    /** A temp repo from a { relPath: text } map; a key ending in "/" is an empty directory. */
    function fixture(files) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "published-imports-"))
      roots.push(root)
      for (const [rel, text] of Object.entries(files)) {
        const target = path.join(root, rel)
        if (rel.endsWith("/")) {
          fs.mkdirSync(target, { recursive: true })
          continue
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, text)
      }
      return root
    }

    const json = (value) => JSON.stringify(value)
    const WORKSPACE = [
      "packages:",
      '  - "apps/*"',
      '  - "packages/core/*"',
      "  - 'packages/connectors/*/*'",
      "  - docs # the docs site",
      "",
      "overrides:",
      '  qs: "^6.16.0"',
    ].join("\n")
    const DOMAIN = "packages/connectors/engine/engine-core"
    const LAYOUT = {
      "pnpm-workspace.yaml": WORKSPACE,
      "apps/cli/package.json": json({
        name: "@miragon/pulse-cli",
        bin: { "pulse-cli": "dist/pulse-cli.js" },
        dependencies: { commander: "14.0.0" },
        devDependencies: { "@miragon/pulse-engine-core": "workspace:*" },
      }),
      "apps/cli/src/index.ts": [
        "import { Command } from 'commander'",
        "import { routes } from '@miragon/pulse-engine-core'",
      ].join("\n"),
      "apps/cli/src/cli.mts": "import u from 'undeclared-mts'",
      "apps/cli/src/a.test.ts": "import { it } from 'vitest'",
      "apps/cli/src/test-support/b.ts": "import { it } from 'vitest'",
      "apps/vscode/package.json": json({ name: "pulse", engines: { vscode: "^1.101.0" } }),
      "apps/vscode/src/extension.ts": "import * as vscode from 'vscode'",
      "apps/mcp-server/package.json": json({
        name: "@miragon/pulse-mcp-server",
        private: true,
      }),
      "apps/mcp-server/src/index.ts": "import 'undeclared-but-private'",
      "apps/leftover/node_modules/": "",
      "packages/core/widget-shell/package.json": json({
        name: "@miragon/pulse-widget-shell",
        peerDependencies: { react: "^19.2.0" },
      }),
      "packages/core/widget-shell/src/ui/a.tsx": "import { useState } from 'react'",
      [`${DOMAIN}/package.json`]: json({ name: "@miragon/pulse-engine-core" }),
      [`${DOMAIN}/src/index.ts`]: "import { z } from 'zod'",
      "docs/package.json": json({ name: "@miragon/pulse-docs", private: true }),
    }
    const findings = (root) =>
      Object.fromEntries(
        publishedPackages(root).map((pkg) => [
          pkg.manifest.name ?? pkg.dir,
          undeclaredImports(pkg),
        ]),
      )

    it("reads non-private apps and packages, not private apps or extensions", () => {
      const root = fixture(LAYOUT)
      assert.deepEqual(
        workspacePackages(root).map((pkg) => pkg.manifest.name),
        // By directory: apps/, docs, packages/connectors/, packages/core/.
        [
          "@miragon/pulse-cli",
          "@miragon/pulse-mcp-server",
          "pulse",
          "@miragon/pulse-docs",
          "@miragon/pulse-engine-core",
          "@miragon/pulse-widget-shell",
        ],
      )
      // The src scan of an app that bundles its domain reports the domain.
      assert.deepEqual(findings(root), {
        "@miragon/pulse-cli": ["cli.mts: undeclared-mts", "index.ts: @miragon/pulse-engine-core"],
        "@miragon/pulse-widget-shell": [],
        "@miragon/pulse-engine-core": ["index.ts: zod"],
      })
    })

    it("accepts a peer dependency, and leaves out an extension that is private too", () => {
      const root = fixture({
        ...LAYOUT,
        [`${DOMAIN}/package.json`]: json({
          name: "@miragon/pulse-engine-core",
          peerDependencies: { zod: "^4.4.0" },
        }),
        "apps/vscode/package.json": json({
          name: "pulse",
          private: true,
          engines: { vscode: "^1.101.0" },
        }),
      })
      assert.deepEqual(findings(root)["@miragon/pulse-engine-core"], [])
      assert.ok(!Object.keys(findings(root)).includes("pulse"))
    })

    it("reads an app that names no VS Code engine and is not private: true", () => {
      const root = fixture({
        ...LAYOUT,
        "apps/vscode/package.json": json({ name: "pulse", engines: { node: ">=22" } }),
        "apps/mcp-server/package.json": json({
          name: "@miragon/pulse-mcp-server",
          private: "true",
        }),
      })
      const found = findings(root)
      assert.deepEqual(found.pulse, ["extension.ts: vscode"])
      assert.deepEqual(found["@miragon/pulse-mcp-server"], ["index.ts: undeclared-but-private"])
    })

    it("reports a published package without src/", () => {
      const root = fixture(
        Object.fromEntries(
          Object.entries(LAYOUT).filter(([rel]) => !rel.startsWith(`${DOMAIN}/src/`)),
        ),
      )
      const [only, ...rest] = findings(root)["@miragon/pulse-engine-core"]
      assert.match(only, /^src\/: missing/)
      assert.deepEqual(rest, [])
    })

    describe("a bundled app is read from its bundle", () => {
      const CLI = { manifest: JSON.parse(LAYOUT["apps/cli/package.json"]) }
      const BUDGET = "apps/cli/test/__golden__/bundle-budget.json"
      const BUNDLED = { dist: "apps/cli/dist", budget: BUDGET }
      /** The layout with these dist files and a budget file; the budget defaults to their size. */
      const withBudget = (files, budget) => ({
        ...LAYOUT,
        ...files,
        [BUDGET]: json({
          $comment: "x",
          dist: budget ?? Object.values(files).reduce((sum, text) => sum + text.length, 0),
        }),
      })

      it("passes a bundle that imports only Node built-ins and its dependencies", () => {
        const root = fixture(
          withBudget({
            "apps/cli/dist/pulse-cli.js": [
              "import { Command } from 'commander'",
              "import fs from 'node:fs'",
              "import { join } from 'path'",
              "const routes = {}",
            ].join("\n"),
          }),
        )
        assert.deepEqual(bundleFindings(root, CLI, BUNDLED), [])
      })

      it("fails a bundle that left a workspace package external", () => {
        const root = fixture(
          withBudget({
            "apps/cli/dist/pulse-cli.js": "import { routes } from '@miragon/pulse-engine-core'",
            "apps/cli/dist/chunk.mjs": "const lazy = () => import(name)",
          }),
        )
        assert.deepEqual(bundleFindings(root, CLI, BUNDLED), [
          `chunk.mjs: ${NON_LITERAL}`,
          "pulse-cli.js: @miragon/pulse-engine-core",
        ])
      })

      const sized = (bytes) =>
        fixture(withBudget({ "apps/cli/dist/pulse-cli.js": "x".repeat(bytes) }, 1000))

      it("fails a bundle over its budget and a missing bundle with the build hint", () => {
        assert.deepEqual(bundleFindings(sized(1001), CLI, BUNDLED), [
          "apps/cli/dist: 1001 bytes, over the budget of 1000",
        ])
        assert.deepEqual(bundleFindings(sized(1000), CLI, BUNDLED), [])
        assert.deepEqual(bundleFindings(fixture(withBudget({}, 1000)), CLI, BUNDLED), [
          "apps/cli/dist is missing: run pnpm build first",
        ])
      })

      it("fails a bundle that shrank more than 10 % below its budget, so the budget comes down", () => {
        assert.deepEqual(bundleFindings(sized(900), CLI, BUNDLED), [])
        const [finding, ...rest] = bundleFindings(sized(899), CLI, BUNDLED)
        assert.match(
          finding,
          /^apps\/cli\/dist: 899 bytes, more than 10 % below the budget of 1000: lower "dist" in apps\/cli\/test\/__golden__\/bundle-budget\.json to /,
        )
        assert.deepEqual(rest, [])
      })

      it("fails a bundle without a budget file or without a ceiling in it", () => {
        const dist = { "apps/cli/dist/pulse-cli.js": "x" }
        assert.throws(
          () => bundleFindings(fixture({ ...LAYOUT, ...dist }), CLI, BUNDLED),
          /bundle-budget\.json is missing: the bundle has no budget/,
        )
        for (const ceiling of [undefined, "1000", 0, 1.5]) {
          const root = fixture({ ...LAYOUT, ...dist, [BUDGET]: json({ dist: ceiling }) })
          assert.throws(() => bundleFindings(root, CLI, BUNDLED), /holds no ceiling/)
        }
      })

      it("reads every bundled app's budget from a ratcheted budget file", () => {
        for (const bundled of Object.values(BUNDLED_APPS)) {
          assert.equal(ratchetKind(bundled.budget), "bundle-budget", bundled.budget)
          assert.ok(bundleBudget(REPO_ROOT, bundled) > 0)
        }
      })
    })

    // The glob syntax itself is the shared expansion's (check-package-scripts.test.mjs).
    it("fails on a workspace without globs", () => {
      const root = fixture({ ...LAYOUT, "pnpm-workspace.yaml": "overrides:\n  qs: x\n" })
      assert.throws(() => workspacePackages(root), /lists no packages: globs/)
    })
  })

  it("reads the repo's seven npm packages (the scanner is not blind)", () => {
    const names = publishedPackages().map(({ manifest }) => manifest.name)
    for (const name of [
      "@miragon/pulse-engine-core",
      "@miragon/pulse-ui",
      "@miragon/pulse-widget-shell",
      "@miragon/pulse-engine-connector",
      "@miragon/pulse-engine-client",
      "@miragon/pulse-analytics-connector",
      "@miragon/pulse-analytics-client",
    ]) {
      assert.ok(names.includes(name), name)
    }
    assert.ok(!names.includes("@miragon/pulse-mcp-server"))
    assert.ok(!names.includes("@miragon/pulse-docs"))
    // The workspace globs reach the server app too (private, so not published).
    assert.ok(
      workspacePackages()
        .map(({ manifest }) => manifest.name)
        .includes("@miragon/pulse-mcp-server"),
    )
  })

  for (const pkg of publishedPackages()) {
    const bundled = BUNDLED_APPS[pkg.manifest.name]
    if (bundled === undefined) {
      it(`${pkg.manifest.name} imports only what it declares`, () => {
        assert.deepEqual(undeclaredImports(pkg), [])
      })
    } else {
      it(`${pkg.manifest.name}'s bundle imports only Node built-ins and its dependencies, within its budget`, () => {
        assert.deepEqual(bundleFindings(REPO_ROOT, pkg, bundled), [])
      })
    }
  }
})
