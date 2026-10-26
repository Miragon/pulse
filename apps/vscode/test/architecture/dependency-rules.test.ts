import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { APP_ROOT, REPO_ROOT } from "./support/files.js"

interface Violation {
  readonly from: string
  readonly to: string
  readonly rule: { readonly name: string }
}

const PLANTED: Readonly<Record<string, string>> = {
  "src/contract/ids.ts": "export const id = 1;\n",
  "src/contract/index.ts": "export * from './ids.ts';\n",
  "src/core/uses-node.ts":
    "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
  "src/core/deep-contract.ts": "export * from '../contract/ids.ts';\n",
  "src/core/cycle-a.ts": "import { b } from './cycle-b.ts';\nexport const a = () => b();\n",
  "src/core/cycle-b.ts": "import { a } from './cycle-a.ts';\nexport const b = () => a();\n",
  "src/core/protocol/index.ts": "export const protocolValue = 1;\n",
  "src/core/protocol/leaky.ts":
    "import { id } from '../../contract/index.ts';\nexport const leaked = id;\n",
  "src/host/not-the-root.ts":
    "import { adapter } from '../adapters/c7/index.ts';\nexport const wired = adapter;\n",
  "src/host/reads-model-library.ts":
    "import { BpmnModdle } from 'bpmn-moddle';\nexport const moddle = BpmnModdle;\n",
  "src/adapters/c7/index.ts": "export const adapter = 1;\n",
  "src/adapters/c7/mapping-uses-node.ts":
    "import { spawn } from 'node:child_process';\nexport const run = spawn;\n",
  "src/adapters/c7/engine-cli/reaches-out.ts":
    "import { id } from '../../../contract/index.ts';\nexport const reach = id;\n",
  "src/adapters/other/index.ts": "export const adapter = 2;\n",
  "src/adapters/other/peer.ts":
    "import { adapter } from '../c7/index.ts';\nexport const peer = adapter;\n",
  "src/webview/runtime-import.ts":
    "import { protocolValue } from '../core/protocol/index.ts';\nexport const value = protocolValue;\n",
  "test/adapters/c7/c7.engine.test.ts":
    "import { adapter } from '../../../src/adapters/c7/index.ts';\nexport const proven = adapter;\n",
  "package.json": '{ "name": "pulse", "private": true }\n',
}

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function plantedTree(): string {
  const root = mkdtempSync(join(tmpdir(), "pulse-vscode-depcruise-"))
  roots.push(root)
  for (const [path, text] of Object.entries(PLANTED)) {
    const file = join(root, "apps", "vscode", path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  symlinkSync(join(APP_ROOT, "node_modules"), join(root, "apps", "vscode", "node_modules"), "dir")
  return root
}

function violationsIn(root: string): string[] {
  const output = execFileSync(
    join(REPO_ROOT, "node_modules/.bin/depcruise"),
    [
      "apps/vscode/src",
      "apps/vscode/test",
      "--config",
      join(APP_ROOT, ".dependency-cruiser.cjs"),
      "--output-type",
      "json",
    ],
    { cwd: root, encoding: "utf8" },
  )
  const result = JSON.parse(output) as { summary: { violations: Violation[] } }
  return result.summary.violations.map(
    (violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`,
  )
}

describe("the dependency rules", () => {
  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const library = "apps/vscode/node_modules/bpmn-moddle/dist/index.js"
    expect(violationsIn(plantedTree()).sort()).toEqual(
      [
        "adapter-proven-on-an-engine: apps/vscode/src/adapters/other/index.ts -> apps/vscode/src/adapters/other/index.ts",
        "engine-test-runs-the-conformance-kit: apps/vscode/test/adapters/c7/c7.engine.test.ts -> apps/vscode/test/adapters/c7/c7.engine.test.ts",
        `model-libraries-stay-in-the-model-adapter: apps/vscode/src/host/reads-model-library.ts -> ${library}`,
        "no-circular: apps/vscode/src/core/cycle-a.ts -> apps/vscode/src/core/cycle-b.ts",
        `no-undeclared-dependencies: apps/vscode/src/host/reads-model-library.ts -> ${library}`,
        "not-in-allowed: apps/vscode/src/adapters/c7/mapping-uses-node.ts -> child_process",
        "not-in-allowed: apps/vscode/src/adapters/other/peer.ts -> apps/vscode/src/adapters/c7/index.ts",
        "not-in-allowed: apps/vscode/src/core/deep-contract.ts -> apps/vscode/src/contract/ids.ts",
        "not-in-allowed: apps/vscode/src/core/uses-node.ts -> fs",
        "not-in-allowed: apps/vscode/src/host/not-the-root.ts -> apps/vscode/src/adapters/c7/index.ts",
        `not-in-allowed: apps/vscode/src/host/reads-model-library.ts -> ${library}`,
        "not-in-allowed: apps/vscode/src/webview/runtime-import.ts -> apps/vscode/src/core/protocol/index.ts",
        "engine-cli-wrapper-is-self-contained: apps/vscode/src/adapters/c7/engine-cli/reaches-out.ts -> apps/vscode/src/contract/index.ts",
        "protocol-imports-nothing: apps/vscode/src/core/protocol/leaky.ts -> apps/vscode/src/contract/index.ts",
      ].sort(),
    )
  })
})
