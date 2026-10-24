import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { builtinModules } from "node:module"
import ts from "typescript"
import { afterEach, describe, expect, it } from "vitest"
import { REPO_ROOT } from "./source-scan.js"

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
 * (the CLI, once it bundles its domain package) fails this src scan by
 * design. The PR that starts bundling replaces the app's src scan with a test
 * over its built bundle (Node built-ins and declared dependencies only) plus a
 * size budget. There is no escape hatch before that test exists.
 */

interface Manifest {
  name?: string
  private?: unknown
  engines?: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface WorkspacePackage {
  dir: string
  manifest: Manifest
}

/** The `packages:` globs of pnpm-workspace.yaml (plain list form). */
function workspaceGlobs(yamlText: string): string[] {
  const globs: string[] = []
  let inPackages = false
  for (const line of yamlText.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const item = /^\s+-\s+["']?([^"'#\s]+)["']?/.exec(line)
    if (item?.[1]) globs.push(item[1])
    else if (/^\S/.test(line)) break
  }
  return globs
}

const childDirs = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "node_modules")
        .map((d) => path.join(dir, d.name))
        .sort()
    : []

/**
 * The directories a workspace glob names. Only literal segments and a whole
 * `*` segment are understood; any other glob fails, so a new workspace tier
 * is never silently left unread.
 */
function expandGlob(root: string, glob: string): string[] {
  return glob.split("/").reduce<string[]>(
    (dirs, segment) => {
      if (segment === "*") return dirs.flatMap(childDirs)
      if (/[*?![\]{}]/.test(segment) || segment === "" || segment === "..") {
        throw new Error(
          `pnpm-workspace.yaml lists "${glob}": published-imports.test.ts expands literal ` +
            `segments and a whole "*" segment only. Write the glob that way or teach expandGlob it.`,
        )
      }
      return dirs.map((dir) => path.join(dir, segment))
    },
    [root],
  )
}

/** Every workspace package of the repo at `root`: each glob's directories that hold a package.json. */
function workspacePackages(root = REPO_ROOT): WorkspacePackage[] {
  const globs = workspaceGlobs(fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  if (globs.length === 0) {
    throw new Error(`${path.join(root, "pnpm-workspace.yaml")} lists no packages: globs`)
  }
  return globs
    .flatMap((glob) => expandGlob(root, glob))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest,
    }))
}

/** Published to npm: not `"private": true`, and no VS Code extension (engines.vscode). */
const isPublishedToNpm = (manifest: Manifest) =>
  manifest.private !== true && manifest.engines?.vscode === undefined

const publishedPackages = (root = REPO_ROOT) =>
  workspacePackages(root).filter(({ manifest }) => isPublishedToNpm(manifest))

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const TEST_SOURCE = /\.test(?:-support)?\.(?:[cm]?[jt]s|[jt]sx)$/

// Shipped means every source a consumer receives, the generated SDK included
// (its imports are the client's own `dependencies`), minus tests and test
// support.
const isShipped = (rel: string) =>
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
function moduleSpecifiers(file: string, source: string): string[] {
  const specifiers: string[] = []
  const literal = (node: ts.Node | undefined) =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : NON_LITERAL
  const visit = (node: ts.Node) => {
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
function importedPackages(file: string, source: string): string[] {
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

/** Each `file: package` a published package's src imports without declaring it. */
function undeclaredImports({ dir, manifest }: WorkspacePackage): string[] {
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
    expect(importedPackages("x.ts", source).sort()).toEqual(
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
    expect(importedPackages("x.ts", source).sort()).toEqual(
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
    expect(importedPackages("x.ts", source)).toEqual([
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
    expect(importedPackages("x.ts", source)).toEqual([])
  })

  it("parses JSX and plain JS modules by their extension", () => {
    expect(importedPackages("x.tsx", "import 'react'\nconst a = <div>{x}</div>")).toEqual(["react"])
    expect(importedPackages("x.cjs", "const c = require('cjs-dep')")).toEqual(["cjs-dep"])
    expect(importedPackages("x.mjs", "import m from 'mjs-dep'")).toEqual(["mjs-dep"])
  })

  it("ships every TS and JS module but tests and test support", () => {
    const shipped = ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.d.ts"]
    expect(shipped.filter(isShipped)).toEqual(shipped)
    expect(
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
    ).toEqual([])
  })

  describe("which packages it reads", () => {
    const roots: string[] = []
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
    })

    /** A temp repo from a { relPath: text } map; a key ending in "/" is an empty directory. */
    function fixture(files: Record<string, string>): string {
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

    const json = (value: unknown) => JSON.stringify(value)
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
    const DOMAIN = "packages/connectors/camunda/camunda7-domain"
    const LAYOUT: Record<string, string> = {
      "pnpm-workspace.yaml": WORKSPACE,
      "apps/cli/package.json": json({
        name: "@miragon/pulse-cli",
        bin: { "pulse-cli": "dist/pulse-cli.js" },
        dependencies: { commander: "14.0.0" },
        devDependencies: { "@miragon/pulse-camunda7-domain": "workspace:*" },
      }),
      "apps/cli/src/index.ts": [
        "import { Command } from 'commander'",
        "import { routes } from '@miragon/pulse-camunda7-domain'",
      ].join("\n"),
      "apps/cli/src/cli.mts": "import u from 'undeclared-mts'",
      "apps/cli/src/a.test.ts": "import { it } from 'vitest'",
      "apps/cli/src/test-support/b.ts": "import { it } from 'vitest'",
      "apps/vscode/package.json": json({ name: "pulse-vscode", engines: { vscode: "^1.101.0" } }),
      "apps/vscode/src/extension.ts": "import * as vscode from 'vscode'",
      "apps/mcp-server-camunda7/package.json": json({
        name: "@miragon/pulse-mcp-server-camunda7",
        private: true,
      }),
      "apps/mcp-server-camunda7/src/index.ts": "import 'undeclared-but-private'",
      "apps/leftover/node_modules/": "",
      "packages/core/widget-shell/package.json": json({
        name: "@miragon/pulse-widget-shell",
        peerDependencies: { react: "^19.2.0" },
      }),
      "packages/core/widget-shell/src/ui/a.tsx": "import { useState } from 'react'",
      [`${DOMAIN}/package.json`]: json({ name: "@miragon/pulse-camunda7-domain" }),
      [`${DOMAIN}/src/index.ts`]: "import { z } from 'zod'",
      "docs/package.json": json({ name: "@miragon/pulse-docs", private: true }),
    }
    const findings = (root: string): Record<string, string[]> =>
      Object.fromEntries(
        publishedPackages(root).map((pkg): [string, string[]] => [
          pkg.manifest.name ?? pkg.dir,
          undeclaredImports(pkg),
        ]),
      )

    it("reads non-private apps and -domain packages, not private apps or extensions", () => {
      const root = fixture(LAYOUT)
      expect(workspacePackages(root).map((pkg) => pkg.manifest.name)).toEqual([
        "@miragon/pulse-cli",
        "@miragon/pulse-mcp-server-camunda7",
        "pulse-vscode",
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-camunda7-domain",
        "@miragon/pulse-docs",
      ])
      // A CLI that bundles its domain before its bundle test exists fails.
      expect(findings(root)).toEqual({
        "@miragon/pulse-cli": [
          "cli.mts: undeclared-mts",
          "index.ts: @miragon/pulse-camunda7-domain",
        ],
        "@miragon/pulse-widget-shell": [],
        "@miragon/pulse-camunda7-domain": ["index.ts: zod"],
      })
    })

    it("accepts a peer dependency, and leaves out an extension that is private too", () => {
      const root = fixture({
        ...LAYOUT,
        [`${DOMAIN}/package.json`]: json({
          name: "@miragon/pulse-camunda7-domain",
          peerDependencies: { zod: "^4.4.0" },
        }),
        "apps/vscode/package.json": json({
          name: "pulse-vscode",
          private: true,
          engines: { vscode: "^1.101.0" },
        }),
      })
      expect(findings(root)["@miragon/pulse-camunda7-domain"]).toEqual([])
      expect(Object.keys(findings(root))).not.toContain("pulse-vscode")
    })

    it("reads an app that names no VS Code engine and is not private: true", () => {
      const root = fixture({
        ...LAYOUT,
        "apps/vscode/package.json": json({ name: "pulse-vscode", engines: { node: ">=22" } }),
        "apps/mcp-server-camunda7/package.json": json({
          name: "@miragon/pulse-mcp-server-camunda7",
          private: "true",
        }),
      })
      expect(findings(root)).toMatchObject({
        "pulse-vscode": ["extension.ts: vscode"],
        "@miragon/pulse-mcp-server-camunda7": ["index.ts: undeclared-but-private"],
      })
    })

    it("reports a published package without src/", () => {
      const root = fixture(
        Object.fromEntries(
          Object.entries(LAYOUT).filter(([rel]) => !rel.startsWith(`${DOMAIN}/src/`)),
        ),
      )
      expect(findings(root)["@miragon/pulse-camunda7-domain"]).toEqual([
        expect.stringMatching(/^src\/: missing/),
      ])
    })

    it("fails on a workspace glob it cannot expand, and on a workspace without globs", () => {
      for (const glob of ["packages/**", "apps/cli-*", "!apps/old", "../outside"]) {
        const root = fixture({ ...LAYOUT, "pnpm-workspace.yaml": `packages:\n  - "${glob}"\n` })
        expect(() => workspacePackages(root)).toThrow(/expands literal segments/)
      }
      const root = fixture({ ...LAYOUT, "pnpm-workspace.yaml": "overrides:\n  qs: x\n" })
      expect(() => workspacePackages(root)).toThrow(/lists no packages: globs/)
    })
  })

  it("reads the repo's five npm packages (the scanner is not blind)", () => {
    const names = publishedPackages().map(({ manifest }) => manifest.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-camunda7-connector",
        "@miragon/pulse-camunda7-client",
        "@miragon/pulse-analytics-connector",
        "@miragon/pulse-analytics-client",
      ]),
    )
    expect(names).not.toContain("@miragon/pulse-mcp-server-camunda7")
    expect(names).not.toContain("@miragon/pulse-docs")
    // The workspace globs reach the server app too (private, so not published).
    expect(workspacePackages().map(({ manifest }) => manifest.name)).toContain(
      "@miragon/pulse-mcp-server-camunda7",
    )
  })

  it.each(publishedPackages().map((pkg) => ({ name: pkg.manifest.name, pkg })))(
    "$name",
    ({ pkg }) => {
      expect(undeclaredImports(pkg)).toEqual([])
    },
  )
})
