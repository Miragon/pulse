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
  "src/adapters/other/index.ts": "export const adapter = 2;\n",
  "src/adapters/other/peer.ts":
    "import { adapter } from '../c7/index.ts';\nexport const peer = adapter;\n",
  "src/webview/runtime-import.ts":
    "import { protocolValue } from '../core/protocol/index.ts';\nexport const value = protocolValue;\n",
  "test/adapters/c7/c7.engine.test.ts":
    "import { adapter } from '../../../src/adapters/c7/index.ts';\nexport const proven = adapter;\n",
  "src/adapters/c7/runs-engine-core.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "src/adapters/c7/ships-engine-core-testing.ts":
    "import { isMissing } from '@miragon/pulse-engine-core/testing';\nexport const missing = isMissing;\n",
  "src/adapters/other/runs-engine-core.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "src/core/runs-engine-core.ts":
    "import type { WaitState } from '@miragon/pulse-engine-core';\nexport type Wait = WaitState;\n",
  "test/adapters/c7/engine-core.test.ts":
    "import { isMissing } from '@miragon/pulse-engine-core/testing';\nexport const missing = isMissing;\n",
  "test/adapters/c7-other/engine-core.test.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "test/core/engine-core.test.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "test/core/escapes-into-engine-core.test.ts":
    "import { rootCause } from '../../../../packages/connectors/engine/engine-core/src/root-cause.ts';\nexport const cause = rootCause;\n",
  "../../packages/connectors/engine/engine-core/src/root-cause.ts": "export const rootCause = 1;\n",
  "package.json":
    '{ "name": "pulse", "private": true, "dependencies": { "@miragon/pulse-engine-core": "workspace:*" } }\n',
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
    const engineCore = "apps/vscode/node_modules/@miragon/pulse-engine-core/dist/index.d.ts"
    const engineCoreTesting =
      "apps/vscode/node_modules/@miragon/pulse-engine-core/dist/testing/index.d.ts"
    expect(violationsIn(plantedTree()).sort()).toEqual(
      [
        `engine-core-only-in-the-c7-adapter: apps/vscode/src/adapters/other/runs-engine-core.ts -> ${engineCore}`,
        `engine-core-only-in-the-c7-adapter: apps/vscode/src/core/runs-engine-core.ts -> ${engineCore}`,
        `engine-core-only-in-the-c7-adapter: apps/vscode/test/adapters/c7-other/engine-core.test.ts -> ${engineCore}`,
        `engine-core-only-in-the-c7-adapter: apps/vscode/test/core/engine-core.test.ts -> ${engineCore}`,
        "engine-core-only-in-the-c7-adapter: apps/vscode/test/core/escapes-into-engine-core.test.ts -> packages/connectors/engine/engine-core/src/root-cause.ts",
        `not-in-allowed: apps/vscode/src/adapters/c7/ships-engine-core-testing.ts -> ${engineCoreTesting}`,
        `not-in-allowed: apps/vscode/src/adapters/other/runs-engine-core.ts -> ${engineCore}`,
        `not-in-allowed: apps/vscode/src/core/runs-engine-core.ts -> ${engineCore}`,
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
        "protocol-imports-nothing: apps/vscode/src/core/protocol/leaky.ts -> apps/vscode/src/contract/index.ts",
      ].sort(),
    )
  })
})
