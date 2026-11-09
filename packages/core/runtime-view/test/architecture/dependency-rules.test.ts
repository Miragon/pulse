import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PLANTED: Readonly<Record<string, string>> = {
  "src/contract/ids.ts": "export const id = 1;\n",
  "src/contract/index.ts": "export * from './ids.ts';\n",
  "src/core/uses-node.ts":
    "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
  "src/core/deep-contract.ts": "export * from '../contract/ids.ts';\n",
  "src/core/through-the-entry.ts": "export * from '../contract/index.ts';\n",
  "src/core/cycle-a.ts": "import { b } from './cycle-b.ts';\nexport const a = () => b();\n",
  "src/core/cycle-b.ts": "import { a } from './cycle-a.ts';\nexport const b = () => a();\n",
  "src/core/index.ts": "export const coreValue = 1;\n",
  "src/core/protocol/index.ts": "export const protocolValue = 1;\n",
  "src/core/protocol/leaky.ts":
    "import { id } from '../../contract/index.ts';\nexport const leaked = id;\n",
  "src/webview/runtime-import.ts":
    "import { protocolValue } from '../core/protocol/index.ts';\nexport const value = protocolValue;\n",
  "src/webview/type-import.ts":
    "import type { protocolValue } from '../core/protocol/index.ts';\nexport type Value = typeof protocolValue;\n",
  "src/host-kit/uses-the-core.ts":
    "import { coreValue } from '../core/index.ts';\nimport { readFileSync } from 'node:fs';\nexport const used = [coreValue, readFileSync];\n",
  "src/host-kit/imports-vscode.ts":
    "import * as vscode from 'vscode';\nexport const api = vscode;\n",
  "src/host-kit/reads-model-library.ts":
    "import { BpmnModdle } from 'bpmn-moddle';\nexport const moddle = BpmnModdle;\n",
  "src/model/reads-model-library.ts":
    "import { BpmnModdle } from 'bpmn-moddle';\nexport const moddle = BpmnModdle;\n",
  "src/core/runs-engine-core.ts":
    "import type { WaitState } from '@miragon/pulse-engine-core';\nexport type Wait = WaitState;\n",
  "test/core/engine-core.test.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "package.json":
    '{ "name": "@miragon/pulse-runtime-view", "private": true, "dependencies": { "bpmn-moddle": "10.3.1" } }\n',
}

const tree = new PlantedTree("packages/core/runtime-view", PLANTED)

afterAll(() => {
  tree.dispose()
})

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    expect(tree.report()).toContain(
      "error not-in-allowed: packages/core/runtime-view/src/core/uses-node.ts → fs No entry of `allowed` in packages/core/runtime-view/.dependency-cruiser.cjs permits this import.",
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const at = (path: string): string => `packages/core/runtime-view/${path}`
    const moddle = at("node_modules/bpmn-moddle/dist/index.js")
    const engineCore = "@miragon/pulse-engine-core"
    expect(tree.violations()).toEqual(
      [
        `model-libraries-stay-in-the-model-adapter: ${at("src/host-kit/reads-model-library.ts")} -> ${moddle}`,
        `no-circular: ${at("src/core/cycle-a.ts")} -> ${at("src/core/cycle-b.ts")}`,
        `not-in-allowed: ${at("src/core/deep-contract.ts")} -> ${at("src/contract/ids.ts")}`,
        `not-in-allowed: ${at("src/core/runs-engine-core.ts")} -> ${engineCore}`,
        `not-in-allowed: ${at("src/core/uses-node.ts")} -> fs`,
        `not-in-allowed: ${at("src/host-kit/imports-vscode.ts")} -> vscode`,
        `not-in-allowed: ${at("src/host-kit/reads-model-library.ts")} -> ${moddle}`,
        `not-in-allowed: ${at("src/webview/runtime-import.ts")} -> ${at("src/core/protocol/index.ts")}`,
        `not-to-unresolvable: ${at("src/core/runs-engine-core.ts")} -> ${engineCore}`,
        `not-to-unresolvable: ${at("src/host-kit/imports-vscode.ts")} -> vscode`,
        `not-to-unresolvable: ${at("test/core/engine-core.test.ts")} -> ${engineCore}`,
        `protocol-imports-nothing: ${at("src/core/protocol/leaky.ts")} -> ${at("src/contract/index.ts")}`,
        `runtime-view-is-engine-neutral: ${at("src/core/runs-engine-core.ts")} -> ${engineCore}`,
        `runtime-view-is-engine-neutral: ${at("test/core/engine-core.test.ts")} -> ${engineCore}`,
      ].sort(),
    )
  })
})
