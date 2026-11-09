import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PLANTED: Readonly<Record<string, string>> = {
  "src/host/wires-the-view.ts":
    "import { PanelTitle } from '@miragon/pulse-runtime-view/host-kit';\nimport type { StateMessage } from '@miragon/pulse-runtime-view/protocol';\nimport type { WorkspaceFiles } from '@miragon/pulse-runtime-view/ports';\nexport type Message = StateMessage | WorkspaceFiles;\nexport const title = PanelTitle;\n",
  "src/host/composition-root.ts":
    "import { C7Adapter } from '@miragon/pulse-c7-adapter';\nimport { BpmnModelSource } from '@miragon/pulse-runtime-view/model';\nexport const wired = [C7Adapter, BpmnModelSource];\n",
  "src/host/not-the-root.ts":
    "import { C7Adapter } from '@miragon/pulse-c7-adapter';\nexport const wired = C7Adapter;\n",
  "src/host/reads-the-model.ts":
    "import { BpmnModelSource } from '@miragon/pulse-runtime-view/model';\nexport const source = BpmnModelSource;\n",
  "src/host/escapes-into-the-view.ts":
    "import { core } from '../../../../packages/core/runtime-view/src/core/index.ts';\nexport const escaped = core;\n",
  "src/host/reads-model-library.ts":
    "import { BpmnModdle } from 'bpmn-moddle';\nexport const moddle = BpmnModdle;\n",
  "src/host/names-an-id.ts":
    "import { InstanceId } from '@miragon/pulse-engine-core';\nexport const id = InstanceId;\n",
  "src/host/ships-the-fake.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "src/host/escapes-into-the-contract.ts":
    "import { RuntimeError } from '../../../../packages/connectors/engine/engine-core/dist/index.js';\nexport const error = RuntimeError;\n",
  "../../packages/connectors/engine/engine-core/dist/index.js": "export const RuntimeError = 1;\n",
  "src/host/runs-c7-core.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "src/host/reads-c7-core-subpath.ts":
    "import { causeOf } from '@miragon/pulse-c7-core/cause';\nexport const cause = causeOf;\n",
  "test/host/escapes-into-c7-core.test.ts":
    "import { causeOf } from '../../../../packages/connectors/c7/c7-core/src/cause.ts';\nexport const cause = causeOf;\n",
  "../../packages/connectors/c7/c7-core/src/cause.ts": "export const causeOf = 1;\n",
  "../../node_modules/@miragon/pulse-c7-core/package.json":
    '{ "name": "@miragon/pulse-c7-core", "exports": { ".": { "types": "./dist/index.d.ts" } } }\n',
  "../../node_modules/@miragon/pulse-c7-core/dist/index.d.ts":
    "export declare const causeOf: number;\n",
  "src/host/cycle-a.ts": "import { b } from './cycle-b.ts';\nexport const a = () => b();\n",
  "src/host/cycle-b.ts": "import { a } from './cycle-a.ts';\nexport const b = () => a();\n",
  "test/host/anything.test.ts":
    "import { C7Adapter } from '@miragon/pulse-c7-adapter';\nimport { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const proven = [C7Adapter, FakeEngine];\n",
  "../../packages/core/runtime-view/src/core/index.ts": "export const core = 1;\n",
  "package.json":
    '{ "name": "pulse-cockpit", "private": true, "dependencies": { "@miragon/pulse-runtime-view": "workspace:*", "@miragon/pulse-c7-adapter": "workspace:*", "@miragon/pulse-engine-core": "workspace:*", "@miragon/pulse-c7-core": "workspace:*" } }\n',
}

const tree = new PlantedTree("apps/vscode", PLANTED)

afterAll(() => {
  tree.dispose()
})

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    expect(tree.report()).toContain(
      "error not-in-allowed: apps/vscode/src/host/not-the-root.ts → apps/vscode/node_modules/@miragon/pulse-c7-adapter/dist/index.d.ts No entry of `allowed` in apps/vscode/.dependency-cruiser.cjs permits this import. Move the code to the layer that may make it (table 'Where code goes' in apps/vscode/CLAUDE.md)",
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const adapter = "apps/vscode/node_modules/@miragon/pulse-c7-adapter/dist/index.d.ts"
    const model = "apps/vscode/node_modules/@miragon/pulse-runtime-view/dist/model/index.d.ts"
    const engineCoreTesting =
      "apps/vscode/node_modules/@miragon/pulse-engine-core/dist/testing/index.d.ts"
    const contractBuild = "packages/connectors/engine/engine-core/dist/index.js"
    const c7Core = "node_modules/@miragon/pulse-c7-core/dist/index.d.ts"
    const c7CoreSubpath = "@miragon/pulse-c7-core/cause"
    const c7CoreSource = "packages/connectors/c7/c7-core/src/cause.ts"
    expect(tree.violations()).toEqual(
      [
        `extension-is-dialect-neutral: apps/vscode/src/host/runs-c7-core.ts -> ${c7Core}`,
        `not-in-allowed: apps/vscode/src/host/runs-c7-core.ts -> ${c7Core}`,
        `extension-is-dialect-neutral: apps/vscode/src/host/reads-c7-core-subpath.ts -> ${c7CoreSubpath}`,
        `not-in-allowed: apps/vscode/src/host/reads-c7-core-subpath.ts -> ${c7CoreSubpath}`,
        `not-to-unresolvable: apps/vscode/src/host/reads-c7-core-subpath.ts -> ${c7CoreSubpath}`,
        `extension-is-dialect-neutral: apps/vscode/test/host/escapes-into-c7-core.test.ts -> ${c7CoreSource}`,
        "model-libraries-stay-in-the-model-adapter: apps/vscode/src/host/reads-model-library.ts -> bpmn-moddle",
        "no-circular: apps/vscode/src/host/cycle-a.ts -> apps/vscode/src/host/cycle-b.ts",
        "not-in-allowed: apps/vscode/src/host/escapes-into-the-view.ts -> packages/core/runtime-view/src/core/index.ts",
        `not-in-allowed: apps/vscode/src/host/not-the-root.ts -> ${adapter}`,
        "not-in-allowed: apps/vscode/src/host/reads-model-library.ts -> bpmn-moddle",
        `not-in-allowed: apps/vscode/src/host/reads-the-model.ts -> ${model}`,
        `not-in-allowed: apps/vscode/src/host/ships-the-fake.ts -> ${engineCoreTesting}`,
        `engine-core-only-by-its-entries: apps/vscode/src/host/escapes-into-the-contract.ts -> ${contractBuild}`,
        `not-in-allowed: apps/vscode/src/host/escapes-into-the-contract.ts -> ${contractBuild}`,
        "not-to-unresolvable: apps/vscode/src/host/reads-model-library.ts -> bpmn-moddle",
      ].sort(),
    )
  })
})
