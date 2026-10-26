import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterEach, describe, expect, it } from "vitest"
import { APP_SCAN, REPO_ROOT, scanSources, type AppScan, type ScanScope } from "./source-scan.js"

/**
 * Which sources the cross-module guards read (source-scan.ts). The fixtures
 * build the layouts that do not exist yet (a CLI under apps/, a VS Code
 * extension, a -domain package) in a temp tree, so the classification is
 * pinned before that code arrives.
 */

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A temp repo from a { relPath: text } map; a key ending in "/" is an empty directory. */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-scan-"))
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

/** Today's layout plus a -domain package, with files every scan must skip. */
const BASE: Record<string, string> = {
  "apps/mcp-server-camunda7/package.json": json({
    name: "@miragon/pulse-mcp-server-camunda7",
    private: true,
  }),
  "apps/mcp-server-camunda7/src/a.ts": "a",
  "packages/core/widget-shell/src/b.ts": "b",
  "packages/core/widget-shell/src/ui/inline-fit.test-support.tsx": "support tsx",
  "packages/core/widget-shell/src/ui/styles.css": "css",
  "packages/core/no-src/package.json": json({ name: "@miragon/pulse-no-src" }),
  "packages/connectors/camunda/camunda7-domain/src/c.ts": "c",
  "packages/connectors/camunda/camunda7-domain/src/routes.mts": "mts",
  "packages/connectors/camunda/camunda7-domain/src/c.test.ts": "test",
  "packages/connectors/camunda/camunda7-domain/src/c.test.tsx": "test tsx",
  "packages/connectors/camunda/camunda7-domain/src/labels.test-support.ts": "support",
  "packages/connectors/camunda/camunda7-domain/src/generated/g.ts": "generated",
  "packages/connectors/camunda/camunda7-domain/src/notes.md": "md",
}

const BASE_FILES = [
  "apps/mcp-server-camunda7/src/a.ts",
  "packages/connectors/camunda/camunda7-domain/src/c.ts",
  "packages/connectors/camunda/camunda7-domain/src/routes.mts",
  "packages/core/widget-shell/src/b.ts",
  "packages/core/widget-shell/src/ui/inline-fit.test-support.tsx",
]

const CLI = {
  "apps/cli/package.json": json({ name: "@miragon/pulse-cli", bin: { "pulse-cli": "dist/x.js" } }),
  "apps/cli/src/index.ts": "cli",
}

const EXTENSION = {
  "apps/vscode/package.json": json({ name: "pulse", engines: { vscode: "^1.101.0" } }),
  "apps/vscode/src/host/extension.ts": "extension",
}

const SERVER_ONLY: Record<string, AppScan> = { "mcp-server-camunda7": "mcp-host" }

const filesIn = (root: string, apps: Record<string, AppScan>, scope?: ScanScope) =>
  scanSources((file) => [file], { root, apps, scope }).sort()

describe("scanSources", () => {
  it("reads every package and the classified apps, skipping tests, .test-support.ts and generated code", () => {
    const root = fixture(BASE)
    expect(filesIn(root, SERVER_ONLY)).toEqual(BASE_FILES)
    // The scan gets the repo-relative path and the file's text.
    expect(
      scanSources((file, text) => [`${file}=${text}`], { root, apps: SERVER_ONLY }).sort()[0],
    ).toBe("apps/mcp-server-camunda7/src/a.ts=a")
  })

  it("fails on an unclassified CLI", () => {
    const root = fixture({ ...BASE, ...CLI })
    expect(() => filesIn(root, SERVER_ONLY)).toThrow(
      /^apps\/cli is not classified in APP_SCAN \(apps\/mcp-server-camunda7\/test\/source-scan\.ts\): add it as "mcp-host" .* or "interface"/,
    )
  })

  it("fails on an unclassified VS Code extension: no manifest field classifies an app", () => {
    const root = fixture({ ...BASE, ...EXTENSION })
    expect(() => filesIn(root, SERVER_ONLY)).toThrow(/^apps\/vscode is not classified in APP_SCAN/)
  })

  it("fails on an app with a src/ but no package.json", () => {
    const root = fixture({ ...BASE, "apps/stray/src/x.ts": "x" })
    expect(() => filesIn(root, SERVER_ONLY)).toThrow(/^apps\/stray is not classified in APP_SCAN/)
  })

  it("does not take an app named like an Object.prototype member as classified", () => {
    const root = fixture({ ...BASE, "apps/constructor/package.json": json({ name: "x" }) })
    expect(() => filesIn(root, SERVER_ONLY)).toThrow(
      /^apps\/constructor is not classified in APP_SCAN/,
    )
  })

  it("ignores a leftover directory that holds neither a package.json nor a src/", () => {
    const root = fixture({ ...BASE, "apps/old/node_modules/": "" })
    expect(filesIn(root, SERVER_ONLY)).toEqual(BASE_FILES)
  })

  it('reads an interface app in scope "all" (the default) and leaves it out of scope "mcp"', () => {
    const root = fixture({ ...BASE, ...CLI, ...EXTENSION })
    const apps: Record<string, AppScan> = { ...SERVER_ONLY, cli: "interface", vscode: "interface" }
    const interfaces = ["apps/cli/src/index.ts", "apps/vscode/src/host/extension.ts"]
    expect(filesIn(root, apps)).toEqual([...interfaces, ...BASE_FILES].sort())
    expect(filesIn(root, apps, "all")).toEqual([...interfaces, ...BASE_FILES].sort())
    expect(filesIn(root, apps, "mcp")).toEqual(BASE_FILES)
  })

  it("tells each scan what a file belongs to: a package, an MCP server app or an interface app", () => {
    const root = fixture({ ...BASE, ...CLI, ...EXTENSION })
    const apps: Record<string, AppScan> = { ...SERVER_ONLY, cli: "interface", vscode: "interface" }
    const owners = scanSources((file, _text, owner) => [`${file} ${owner}`], { root, apps })
    expect(owners.sort()).toEqual([
      "apps/cli/src/index.ts interface",
      "apps/mcp-server-camunda7/src/a.ts mcp-host",
      "apps/vscode/src/host/extension.ts interface",
      "packages/connectors/camunda/camunda7-domain/src/c.ts package",
      "packages/connectors/camunda/camunda7-domain/src/routes.mts package",
      "packages/core/widget-shell/src/b.ts package",
      "packages/core/widget-shell/src/ui/inline-fit.test-support.tsx package",
    ])
  })

  it('reads a second MCP server app in scope "mcp" too', () => {
    const root = fixture({
      ...BASE,
      "apps/other-server/package.json": json({ name: "x", engines: { node: ">=22" } }),
      "apps/other-server/src/s.ts": "s",
      "apps/bare-server/src/t.ts": "t",
    })
    const apps: Record<string, AppScan> = {
      ...SERVER_ONLY,
      "other-server": "mcp-host",
      "bare-server": "mcp-host",
    }
    expect(filesIn(root, apps, "mcp")).toEqual(
      [...BASE_FILES, "apps/other-server/src/s.ts", "apps/bare-server/src/t.ts"].sort(),
    )
  })

  it("fails on an entry that names no app", () => {
    const root = fixture({ ...BASE, "apps/old/node_modules/": "" })
    expect(() => filesIn(root, { ...SERVER_ONLY, vscode: "interface", old: "interface" })).toThrow(
      /^APP_SCAN classifies apps\/vscode, which is no app \(no package\.json, no src\/\): drop the entry\.$/,
    )
  })

  it("fails on a classified app without src/: its sources would be read by no guard", () => {
    const root = fixture({
      ...BASE,
      "apps/vscode/package.json": json({ name: "pulse", engines: { vscode: "^1.101.0" } }),
      "apps/vscode/packages/core/src/x.ts": "x",
    })
    expect(() => filesIn(root, { ...SERVER_ONLY, vscode: "interface" })).toThrow(
      /^apps\/vscode is classified in APP_SCAN but has no src\/: .* Move its sources to apps\/vscode\/src\.$/,
    )
  })

  it('fails on a VS Code extension classified as "mcp-host"', () => {
    const root = fixture({ ...BASE, ...EXTENSION })
    expect(() => filesIn(root, { ...SERVER_ONLY, vscode: "mcp-host" })).toThrow(
      /^apps\/vscode declares engines\.vscode .* classify it as "interface"\.$/,
    )
  })
})

describe("the repo's apps", () => {
  it("are all classified in APP_SCAN, and every entry names one", () => {
    const apps = fs
      .readdirSync(path.join(REPO_ROOT, "apps"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter(
        (name) =>
          fs.existsSync(path.join(REPO_ROOT, "apps", name, "package.json")) ||
          fs.existsSync(path.join(REPO_ROOT, "apps", name, "src")),
      )
    expect(Object.keys(APP_SCAN).sort()).toEqual(apps.sort())
  })

  it("are read by the default scan and the MCP scan (the scanner is not blind)", () => {
    const all = scanSources((file) => [file])
    const mcp = scanSources((file) => [file], { scope: "mcp" })
    for (const files of [all, mcp]) {
      expect(files).toEqual(
        expect.arrayContaining([
          "apps/mcp-server-camunda7/src/index.ts",
          "packages/core/widget-shell/src/profile.ts",
          "packages/connectors/camunda/camunda7-connector/src/module.ts",
        ]),
      )
    }
    expect(all.some((file) => /\.test\.tsx?$|\/generated\//.test(file))).toBe(false)
  })
})

/**
 * The scope each guard reads, pinned at its call site: an interface app is
 * read by the tool-name checks (literals, quoted parameters, prose) and by no
 * widget rule, no helper resolution and no server-only guard. Today APP_SCAN
 * classifies no interface app, so a scope switched at a call site would change
 * no result yet; this reads the guard files themselves.
 */
describe("the guards' scan scopes", () => {
  /** Each scanSources call of a guard file, in source order: the scan it runs and the scope it reads. */
  function scanCalls(rel: string): Array<[scan: string, scope: ScanScope]> {
    const file = path.join(REPO_ROOT, "apps/mcp-server-camunda7/test", rel)
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    )
    const consts = new Map<string, ts.Expression>()
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer)
          consts.set(decl.name.text, decl.initializer)
      }
    }
    /** The scope an options argument sets: its literal `scope`, else the default "all". */
    const scopeOf = (arg: ts.Expression | undefined): ScanScope => {
      const options = arg && ts.isIdentifier(arg) ? consts.get(arg.text) : arg
      if (!options || !ts.isObjectLiteralExpression(options)) return "all"
      const scope = options.properties.find(
        (member) => member.name !== undefined && member.name.getText() === "scope",
      )
      if (scope === undefined) return "all"
      if (ts.isPropertyAssignment(scope) && ts.isStringLiteral(scope.initializer)) {
        return scope.initializer.text as ScanScope
      }
      throw new Error(
        `${rel}: a scope this test cannot read (${scope.getText()}): write it literally`,
      )
    }
    /** The scan's name: the function passed, or the first function the arrow calls. */
    const scanOf = (arg: ts.Expression): string => {
      if (ts.isIdentifier(arg)) return arg.text
      let name = "?"
      const visit = (node: ts.Node) => {
        if (name === "?" && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          name = node.expression.text
        }
        ts.forEachChild(node, visit)
      }
      visit(arg)
      return name
    }
    const calls: Array<[string, ScanScope]> = []
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "scanSources" &&
        node.arguments[0] !== undefined
      ) {
        calls.push([scanOf(node.arguments[0]), scopeOf(node.arguments[1])])
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return calls
  }

  it("tool-name-refs: literals and quoted parameters read every app, the helpers only the MCP side", () => {
    expect(scanCalls("tool-name-refs.test.ts")).toEqual([
      ["collectTextHelpers", "mcp"],
      ["findParamRefs", "all"],
      ["findToolNameLiterals", "all"],
    ])
  })

  it("hand-off-surface: the widget rules read the MCP side, the prose check every app", () => {
    expect(scanCalls("hand-off-surface.test.ts")).toEqual([
      ["findIdentifiers", "mcp"],
      ["findIdentifiers", "mcp"],
      ["findModelContextContents", "mcp"],
      ["findContextFunctions", "mcp"],
      ["findDescribeForModelArgs", "mcp"],
      ["findHandOffSpecs", "mcp"],
      ["findProseToolNames", "all"],
    ])
  })

  it("setup-env: the PULSE_ guard reads the packages and the MCP server apps", () => {
    expect(scanCalls("setup-env.test.ts")).toEqual([["pulseLines", "mcp"]])
  })
})
