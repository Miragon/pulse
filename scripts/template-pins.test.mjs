import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import ts from "typescript"
import { REPO_ROOT } from "./source-scan.mjs"
import {
  caretAdmits,
  checkTemplatePins,
  FORMATTER,
  MCP_SCOPE,
  mcpPackages,
  peerRuleFindings,
  SHARED_LIBRARIES,
  templatePinFindings,
  workspacePins,
} from "./template-pins.mjs"

const VIEW_BUNDLE = "packages/core/widget-shell/src/view-bundle.ts"
/** The starter's own pin guard: it holds a user's copy, where template-pins never runs. */
const STARTER_PINS_TEST = "templates/composed-server/server/test/pins.test.ts"

/** The string entries of the array literal `name` is declared with in `source` (TypeScript AST). */
function stringArray(source, file, name) {
  let entries
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) {
      let init = node.initializer
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) {
        init = init.expression
      }
      if (init && ts.isArrayLiteralExpression(init)) {
        entries = init.elements.filter(ts.isStringLiteralLike).map((element) => element.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
  if (entries === undefined) throw new Error(`no ${name} array in ${file}`)
  return entries
}

/** The string entries of the `VIEW_BUNDLE_DEDUPE` array literal in `source`. */
const viewBundleDedupe = (source) => stringArray(source, VIEW_BUNDLE, "VIEW_BUNDLE_DEDUPE")

/**
 * The deduped packages template-pins does not hold to the workspace's pin: every one but the
 * workspace's own libraries (held to its version) is a SHARED_LIBRARIES entry.
 */
const unpinnedDedupe = (source, shared = SHARED_LIBRARIES) =>
  viewBundleDedupe(source).filter(
    (name) => !name.startsWith("@miragon/pulse-") && !shared.includes(name),
  )

const WORKSPACE = [
  {
    dir: "packages/core/widget-shell",
    manifest: {
      dependencies: { "@modelcontextprotocol/node": "2.1.2" },
      peerDependencies: {
        "@modelcontextprotocol/server": "^2.4.0",
        react: "^19.2.0",
        zod: "^4.4.0",
      },
      devDependencies: {
        "@modelcontextprotocol/server": "2.4.0",
        "@tanstack/react-query": "5.103.2",
        "lucide-react": "1.61.0",
        react: "19.3.1",
        "react-dom": "19.3.1",
        zod: "4.6.7",
      },
    },
  },
  {
    dir: "apps/mcp-server",
    manifest: {
      dependencies: { zod: "4.6.7" },
      devDependencies: {
        "@modelcontextprotocol/client": "2.4.0",
        "@modelcontextprotocol/inspector": "2.14.0",
      },
    },
  },
]
const VERSIONS = { "@miragon/pulse-widget-shell": "0.24.2", "@miragon/pulse-ui": "0.24.2" }
/** The root manifest of the fixture workspace: its tooling, the formatter among it. */
const ROOT_MANIFEST = {
  devDependencies: { prettier: "3.9.10", "prettier-plugin-tailwindcss": "0.8.1" },
}

/** What the fixture workspace holds the template to: the shared libraries and its SDK packages. */
const HELD = [...SHARED_LIBRARIES, ...mcpPackages(WORKSPACE)]

/** The findings of one template manifest against the fixture workspace. */
function findings(manifest, workspace = WORKSPACE) {
  const { pins, errors } = workspacePins(workspace, HELD)
  assert.deepEqual(errors, [])
  return templatePinFindings([{ file: "modules/m/package.json", manifest }], {
    versions: VERSIONS,
    pins,
  })
}

const HOLDS = {
  peerDependencies: {
    "@miragon/pulse-widget-shell": "^0.24.2",
    "@modelcontextprotocol/server": "^2.4.0",
    react: "^19.2.0",
    zod: "^4.4.0",
  },
  devDependencies: {
    "@miragon/pulse-ui": "0.24.2",
    "@miragon/pulse-widget-shell": "0.24.2",
    "@modelcontextprotocol/inspector": "2.14.0",
    "@modelcontextprotocol/server": "2.4.0",
    "@tanstack/react-query": "5.103.2",
    "lucide-react": "1.61.0",
    react: "19.3.1",
    "react-dom": "19.3.1",
    typescript: "5.9.3",
    zod: "4.6.7",
  },
}
const withPin = (stanza, name, spec) => ({
  ...HOLDS,
  [stanza]: { ...HOLDS[stanza], [name]: spec },
})

describe("template-pins", () => {
  it("passes a module that pins like the workspace, ranged pulse peers included", () => {
    assert.deepEqual(findings(HOLDS), { unknown: [], drifted: [] })
  })

  it("leaves a library the workspace does not share alone (typescript, vitest)", () => {
    assert.deepEqual(findings(withPin("devDependencies", "typescript", "1.0.0")).drifted, [])
  })

  for (const name of SHARED_LIBRARIES) {
    it(`fails ${name} pinned off the workspace's exact pin`, () => {
      const { drifted } = findings(withPin("devDependencies", name, "0.0.1"))
      assert.equal(drifted.length, 1)
      assert.match(drifted[0], new RegExp(`${name} pinned 0\\.0\\.1, the workspace \\S+$`))
    })
  }

  it("holds a peer to the workspace's peer range, the SDK's too", () => {
    assert.match(
      findings(withPin("peerDependencies", "react", "^19.0.0")).drifted.join("\n"),
      /\(peerDependencies\): react pinned \^19\.0\.0, the workspace \^19\.2\.0/,
    )
    assert.match(
      findings(withPin("peerDependencies", "@modelcontextprotocol/server", "2.4.0")).drifted.join(
        "\n",
      ),
      /@modelcontextprotocol\/server pinned 2\.4\.0, the workspace \^2\.4\.0/,
    )
  })

  // CLAUDE.md, Contracts: a module that imports an SDK package widget-shell brings along peers it
  // in a range, so the starter's one copy (widget-shell's exact pin) satisfies it.
  it("admits a caret peer of an SDK package the workspace pins but never peers", () => {
    for (const range of ["^2.1.2", "^2.1.0", "^2.0.0", "2.1.2"]) {
      assert.deepEqual(findings(withPin("peerDependencies", "@modelcontextprotocol/node", range)), {
        unknown: [],
        drifted: [],
      })
    }
    for (const range of ["^2.1.3", "^2.2.0", "^3.0.0", "^1.0.0", "~2.1.2", ">=2.0.0", "*"]) {
      assert.deepEqual(
        findings(withPin("peerDependencies", "@modelcontextprotocol/node", range)).drifted,
        [
          `modules/m/package.json (peerDependencies): @modelcontextprotocol/node pinned ${range}, ` +
            "the workspace 2.1.2, or a caret range that admits it",
        ],
      )
    }
    assert.equal(caretAdmits("^0.1.0", "0.1.2"), false)
    assert.equal(caretAdmits("^2.0.4", "2.0.4"), true)
  })

  it("holds every SDK package the workspace pins, whichever stanza pins it there", () => {
    assert.deepEqual(mcpPackages(WORKSPACE), [
      "@modelcontextprotocol/client",
      "@modelcontextprotocol/inspector",
      "@modelcontextprotocol/node",
      "@modelcontextprotocol/server",
    ])
    assert.ok(mcpPackages(WORKSPACE).every((name) => name.startsWith(MCP_SCOPE)))
    for (const [stanza, name, spec, workspace] of [
      ["devDependencies", "@modelcontextprotocol/inspector", "2.13.0", "2.14.0"],
      ["devDependencies", "@modelcontextprotocol/client", "2.4.1", "2.4.0"],
      ["dependencies", "@modelcontextprotocol/node", "2.1.3", "2.1.2"],
      ["dependencies", "@modelcontextprotocol/server", "2.5.0", "2.4.0"],
    ]) {
      assert.deepEqual(findings(withPin(stanza, name, spec)).drifted, [
        `modules/m/package.json (${stanza}): ${name} pinned ${spec}, the workspace ${workspace}`,
      ])
    }
    // An SDK package the workspace never pins stays the template's own.
    assert.deepEqual(
      findings(withPin("devDependencies", "@modelcontextprotocol/ext-tasks", "0.2.3")).drifted,
      [],
    )
  })

  it("holds a pulse library to the workspace version: exact, or ^version as a peer", () => {
    assert.match(
      findings(withPin("devDependencies", "@miragon/pulse-ui", "0.24.1")).drifted.join("\n"),
      /@miragon\/pulse-ui pinned 0\.24\.1, the workspace 0\.24\.2/,
    )
    assert.match(
      findings(withPin("peerDependencies", "@miragon/pulse-widget-shell", "0.24.2")).drifted.join(
        "\n",
      ),
      /\(peerDependencies\): @miragon\/pulse-widget-shell pinned 0\.24\.2, the workspace \^0\.24\.2/,
    )
  })

  it("holds the formatter to the workspace's exact pin, one only the root manifest holds too", () => {
    const workspace = [{ dir: "the root package.json", manifest: ROOT_MANIFEST }, ...WORKSPACE]
    const { pins, errors } = workspacePins(workspace, [...SHARED_LIBRARIES, ...FORMATTER])
    assert.deepEqual(errors, [])
    const starter = (prettier) => [
      {
        file: "package.json",
        manifest: { devDependencies: { prettier, "prettier-plugin-tailwindcss": "0.8.1" } },
      },
    ]
    const check = (prettier) => templatePinFindings(starter(prettier), { versions: VERSIONS, pins })
    assert.deepEqual(check("3.9.10"), { unknown: [], drifted: [] })
    assert.deepEqual(check("3.8.0").drifted, [
      "package.json (devDependencies): prettier pinned 3.8.0, the workspace 3.9.10",
    ])
    assert.match(
      workspacePins(WORKSPACE, FORMATTER).errors.join("\n"),
      /pins prettier-plugin-tailwindcss nowhere/,
    )
  })

  it("fails the old scope and a pulse name the workspace publishes no library under", () => {
    const { unknown } = findings({
      dependencies: { "@miragon-ai/widget-shell": "0.20.0", "@miragon/pulse-cli": "0.24.2" },
    })
    assert.deepEqual(unknown, [
      "modules/m/package.json (dependencies): @miragon-ai/widget-shell is the old scope, renamed to @miragon/pulse-*",
      "modules/m/package.json (dependencies): @miragon/pulse-cli is no library of this workspace",
    ])
  })

  it("fails a workspace that pins a shared library two ways or not at all", () => {
    const split = structuredClone(WORKSPACE)
    split[1].manifest.devDependencies.react = "19.3.0"
    assert.match(
      workspacePins(split).errors.join("\n"),
      /pins react 2 ways \(19\.3\.1 in packages\/core\/widget-shell \(devDependencies\); 19\.3\.0 in apps\/mcp-server \(devDependencies\)\)/,
    )
    const peers = structuredClone(WORKSPACE)
    peers[1].manifest.peerDependencies = { zod: "^4.0.0" }
    assert.match(workspacePins(peers).errors.join("\n"), /peers zod 2 ways/)
    assert.match(workspacePins(WORKSPACE, ["left-pad"]).errors.join("\n"), /pins left-pad nowhere/)
  })

  it("fails a workspace that pins an SDK package two ways", () => {
    const split = structuredClone(WORKSPACE)
    split[1].manifest.devDependencies["@modelcontextprotocol/server"] = "2.4.1"
    assert.match(
      workspacePins(split, mcpPackages(split)).errors.join("\n"),
      /pins @modelcontextprotocol\/server 2 ways/,
    )
  })

  it("fails the template's install when strict peers are off or missing", () => {
    const yaml = (strict) => `${strict}packages:\n  - "server"\n  - "modules/*"\n`
    assert.deepEqual(peerRuleFindings(yaml("strictPeerDependencies: true\n")), [])
    for (const [strict, found] of [
      ["strictPeerDependencies: false\n", "false"],
      ['strictPeerDependencies: "true"\n', '"true"'],
      ["", "missing"],
    ]) {
      assert.deepEqual(peerRuleFindings(yaml(strict)), [
        "templates/composed-server/pnpm-workspace.yaml: strictPeerDependencies is " +
          `${found}, expected true: an unmet peer must fail the starter's install, or a split ` +
          "@miragon/pulse-* or MCP SDK bump installs",
      ])
    }
  })

  it("names a missing template pnpm-workspace.yaml instead of crashing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "template-pins-"))
    try {
      const write = (file, content) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        writeFileSync(path.join(root, file), content)
      }
      write("pnpm-workspace.yaml", 'packages:\n  - "packages/core/*"\n  - "apps/*"\n')
      write("package.json", JSON.stringify(ROOT_MANIFEST))
      for (const { dir, manifest } of WORKSPACE) {
        write(`${dir}/package.json`, JSON.stringify(manifest))
      }
      write("templates/composed-server/server/package.json", "{}")
      assert.deepEqual(checkTemplatePins(root).slice(1), [
        "No templates/composed-server/pnpm-workspace.yaml: the starter installs its workspace " +
          "and its peer rules from it",
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("holds in the repo: the template pins what the workspace pins", () => {
    assert.deepEqual(checkTemplatePins(REPO_ROOT), [])
  })

  it("holds the starter's own pin guard to SHARED_LIBRARIES", () => {
    const source = readFileSync(path.join(REPO_ROOT, STARTER_PINS_TEST), "utf8")
    assert.deepEqual(
      [...stringArray(source, STARTER_PINS_TEST, "SHARED_LIBRARIES")].sort(),
      [...SHARED_LIBRARIES].sort(),
    )
  })

  // One list of what a view bundle resolves once: widget-shell's VIEW_BUNDLE_DEDUPE. A package
  // added there carries a context, so the template must pin it as the workspace does.
  it("pins every package the view bundle dedupes", () => {
    const source = readFileSync(path.join(REPO_ROOT, VIEW_BUNDLE), "utf8")
    assert.deepEqual(unpinnedDedupe(source), [])
    assert.ok(viewBundleDedupe(source).includes("react"), "the reader sees the real list")
  })

  it("fails a deduped package SHARED_LIBRARIES leaves out", () => {
    const source = `export const VIEW_BUNDLE_DEDUPE = ["react", "@miragon/pulse-ui", "jotai"] as const`
    assert.deepEqual(unpinnedDedupe(source), ["jotai"])
    assert.deepEqual(unpinnedDedupe(source, ["jotai"]), ["react"])
    assert.throws(() => viewBundleDedupe("export const OTHER = []"), /no VIEW_BUNDLE_DEDUPE array/)
  })
})
