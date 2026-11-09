import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PLANTED: Readonly<Record<string, string>> = {
  "src/host/wires-the-view.ts":
    "import { PanelTitle } from '@miragon/pulse-runtime-view/host-kit';\nimport type { StateMessage } from '@miragon/pulse-runtime-view/protocol';\nexport type Message = StateMessage;\nexport const title = PanelTitle;\n",
  "src/host/composition-root.ts":
    "import { C7Adapter } from '@miragon/pulse-engine-adapter';\nimport { BpmnModelSource } from '@miragon/pulse-runtime-view/model';\nexport const wired = [C7Adapter, BpmnModelSource];\n",
  "src/host/not-the-root.ts":
    "import { C7Adapter } from '@miragon/pulse-engine-adapter';\nexport const wired = C7Adapter;\n",
  "src/host/reads-the-model.ts":
    "import { BpmnModelSource } from '@miragon/pulse-runtime-view/model';\nexport const source = BpmnModelSource;\n",
  "src/host/escapes-into-the-view.ts":
    "import { core } from '../../../../packages/core/runtime-view/src/core/index.ts';\nexport const escaped = core;\n",
  "src/host/reads-model-library.ts":
    "import { BpmnModdle } from 'bpmn-moddle';\nexport const moddle = BpmnModdle;\n",
  "src/host/runs-engine-core.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "src/host/cycle-a.ts": "import { b } from './cycle-b.ts';\nexport const a = () => b();\n",
  "src/host/cycle-b.ts": "import { a } from './cycle-a.ts';\nexport const b = () => a();\n",
  "test/host/anything.test.ts":
    "import { C7Adapter } from '@miragon/pulse-engine-adapter';\nexport const proven = C7Adapter;\n",
  "../../packages/core/runtime-view/src/core/index.ts": "export const core = 1;\n",
  "package.json":
    '{ "name": "pulse-cockpit", "private": true, "dependencies": { "@miragon/pulse-runtime-view": "workspace:*", "@miragon/pulse-engine-adapter": "workspace:*" } }\n',
}

const tree = new PlantedTree("apps/vscode", PLANTED)

afterAll(() => {
  tree.dispose()
})

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    expect(tree.report()).toContain(
      "error not-in-allowed: apps/vscode/src/host/not-the-root.ts → apps/vscode/node_modules/@miragon/pulse-engine-adapter/dist/index.d.ts No entry of `allowed` in apps/vscode/.dependency-cruiser.cjs permits this import. Move the code to the layer that may make it (table 'Where code goes' in apps/vscode/CLAUDE.md)",
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const adapter = "apps/vscode/node_modules/@miragon/pulse-engine-adapter/dist/index.d.ts"
    const model = "apps/vscode/node_modules/@miragon/pulse-runtime-view/dist/model/index.d.ts"
    expect(tree.violations()).toEqual(
      [
        "extension-is-engine-neutral: apps/vscode/src/host/runs-engine-core.ts -> @miragon/pulse-engine-core",
        "model-libraries-stay-in-the-model-adapter: apps/vscode/src/host/reads-model-library.ts -> bpmn-moddle",
        "no-circular: apps/vscode/src/host/cycle-a.ts -> apps/vscode/src/host/cycle-b.ts",
        "not-in-allowed: apps/vscode/src/host/escapes-into-the-view.ts -> packages/core/runtime-view/src/core/index.ts",
        `not-in-allowed: apps/vscode/src/host/not-the-root.ts -> ${adapter}`,
        "not-in-allowed: apps/vscode/src/host/reads-model-library.ts -> bpmn-moddle",
        `not-in-allowed: apps/vscode/src/host/reads-the-model.ts -> ${model}`,
        "not-in-allowed: apps/vscode/src/host/runs-engine-core.ts -> @miragon/pulse-engine-core",
        "not-to-unresolvable: apps/vscode/src/host/reads-model-library.ts -> bpmn-moddle",
        "not-to-unresolvable: apps/vscode/src/host/runs-engine-core.ts -> @miragon/pulse-engine-core",
      ].sort(),
    )
  })
})
