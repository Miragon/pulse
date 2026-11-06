import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import ts from "typescript"
import { REPO_ROOT } from "./source-scan.mjs"
import {
  checkTemplatePins,
  INSPECTOR_LUCIDE,
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
      peerDependencies: { "mcp-use": "2.12.2", react: "^19.2.0", zod: "^4.4.0" },
      devDependencies: {
        "@tanstack/react-query": "5.103.2",
        "lucide-react": "1.61.0",
        "mcp-use": "2.12.2",
        react: "19.3.1",
        "react-dom": "19.3.1",
        zod: "4.6.7",
      },
    },
  },
  {
    dir: "apps/mcp-server",
    manifest: { dependencies: { "mcp-use": "2.12.2", zod: "4.6.7" }, devDependencies: {} },
  },
]
const VERSIONS = { "@miragon/pulse-widget-shell": "0.24.2", "@miragon/pulse-ui": "0.24.2" }

/** The findings of one template manifest against the fixture workspace. */
function findings(manifest, workspace = WORKSPACE) {
  const { pins, errors } = workspacePins(workspace)
  assert.deepEqual(errors, [])
  return templatePinFindings([{ file: "modules/m/package.json", manifest }], {
    versions: VERSIONS,
    pins,
  })
}

const HOLDS = {
  peerDependencies: {
    "@miragon/pulse-widget-shell": "^0.24.2",
    "mcp-use": "2.12.2",
    react: "^19.2.0",
    zod: "^4.4.0",
  },
  devDependencies: {
    "@miragon/pulse-ui": "0.24.2",
    "@miragon/pulse-widget-shell": "0.24.2",
    "@tanstack/react-query": "5.103.2",
    "lucide-react": "1.61.0",
    "mcp-use": "2.12.2",
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

  it("holds a peer to the workspace's peer range, mcp-use to its exact pin", () => {
    assert.match(
      findings(withPin("peerDependencies", "react", "^19.0.0")).drifted.join("\n"),
      /\(peerDependencies\): react pinned \^19\.0\.0, the workspace \^19\.2\.0/,
    )
    assert.match(
      findings(withPin("peerDependencies", "mcp-use", "^2.12.2")).drifted.join("\n"),
      /mcp-use pinned \^2\.12\.2, the workspace 2\.12\.2/,
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

  it("fails a ranged mcp-use peer in the workspace", () => {
    const ranged = structuredClone(WORKSPACE)
    ranged[0].manifest.peerDependencies["mcp-use"] = "^2.12.2"
    assert.match(
      workspacePins(ranged).errors.join("\n"),
      /mcp-use must be exact as a peer too: peer \^2\.12\.2, pin 2\.12\.2/,
    )
  })

  it("fails the template's install when strict peers are off or missing", () => {
    const { pins } = workspacePins(WORKSPACE)
    const yaml = (strict) =>
      `${strict}peerDependencyRules:\n  allowedVersions:\n    "${INSPECTOR_LUCIDE}": "1"\n`
    assert.deepEqual(peerRuleFindings(yaml("strictPeerDependencies: true\n"), pins), [])
    for (const [strict, found] of [
      ["strictPeerDependencies: false\n", "false"],
      ['strictPeerDependencies: "true"\n', '"true"'],
      ["", "missing"],
    ]) {
      assert.deepEqual(peerRuleFindings(yaml(strict), pins), [
        "templates/composed-server/pnpm-workspace.yaml: strictPeerDependencies is " +
          `${found}, expected true: an unmet peer must fail the starter's install, or a split ` +
          "@miragon/pulse-* or mcp-use bump installs",
      ])
    }
  })

  it("allows mcp-use's inspector the lucide-react major the workspace pins, and no other", () => {
    const { pins } = workspacePins(WORKSPACE)
    const rule = (value) =>
      "strictPeerDependencies: true\n" +
      `peerDependencyRules:\n  allowedVersions:\n    "${INSPECTOR_LUCIDE}": ${value}\n`
    assert.deepEqual(peerRuleFindings(rule('"1"'), pins), [])
    assert.deepEqual(peerRuleFindings(rule("1"), pins), [], "an unquoted major parses as 1")
    for (const [value, found] of [
      ['"1.61.0"', '"1.61.0"'],
      ['"2"', '"2"'],
    ]) {
      assert.deepEqual(peerRuleFindings(rule(value), pins), [
        "templates/composed-server/pnpm-workspace.yaml: peerDependencyRules.allowedVersions " +
          `"${INSPECTOR_LUCIDE}" is ${found}, the workspace pins lucide-react 1.61.0: allow its ` +
          'major, "1"',
      ])
    }
    assert.match(
      peerRuleFindings('strictPeerDependencies: true\npackages:\n  - "server"\n', pins).join("\n"),
      /"@mcp-use\/inspector>lucide-react" is missing, the workspace pins lucide-react 1\.61\.0/,
    )
  })

  it("names a missing template pnpm-workspace.yaml instead of crashing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "template-pins-"))
    try {
      const write = (file, content) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        writeFileSync(path.join(root, file), content)
      }
      write("pnpm-workspace.yaml", 'packages:\n  - "packages/core/*"\n  - "apps/*"\n')
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
