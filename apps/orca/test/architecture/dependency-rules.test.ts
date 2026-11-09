import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PLANTED: Readonly<Record<string, string>> = {
  "src/protocol.ts":
    "import type { StateMessage } from '@miragon/pulse-runtime-view/protocol';\nexport type Message = StateMessage;\n",
  "src/worker/wires-the-view.ts":
    "import { PanelTitle } from '@miragon/pulse-runtime-view/host-kit';\nimport type { OrcaWorkerApi } from 'orca/worker';\nimport { readFile } from 'node:fs/promises';\nimport type { Message } from '../protocol.ts';\nexport type Api = OrcaWorkerApi | Message;\nexport const used = [PanelTitle, readFile];\n",
  "src/worker/composition-root.ts":
    "import { C7Adapter } from '@miragon/pulse-engine-adapter';\nimport { BpmnModelSource } from '@miragon/pulse-runtime-view/model';\nexport const wired = [C7Adapter, BpmnModelSource];\n",
  "src/worker/not-the-root.ts":
    "import { C7Adapter } from '@miragon/pulse-engine-adapter';\nexport const wired = C7Adapter;\n",
  "src/worker/draws.ts": "import { Text } from 'orca';\nexport const text = Text;\n",
  "src/worker/runs-engine-core.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "src/panel/reaches-the-worker-api.ts":
    "import type { OrcaWorkerApi } from 'orca/worker';\nexport type Api = OrcaWorkerApi;\n",
  "src/panel/draws.ts":
    "import { Text } from 'orca';\nimport type { Message } from '../protocol.ts';\nexport type Shown = Message;\nexport const text = Text;\n",
  "src/panel/reaches-the-worker.ts":
    "import { used } from '../worker/wires-the-view.ts';\nexport const reached = used;\n",
  "src/panel/runs-the-core.ts":
    "import { BoardParser } from '@miragon/pulse-runtime-view/core';\nexport const parser = BoardParser;\n",
  "src/editor/reads-the-protocol.ts":
    "import type { Message } from '../protocol.ts';\nexport type Shown = Message;\n",
  "src/editor/reads-node.ts":
    "import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n",
  "src/editor/reads-model-library.ts":
    "import { BpmnModdle } from 'bpmn-moddle';\nexport const moddle = BpmnModdle;\n",
  "test/worker/anything.test.ts":
    "import { rootCause } from '@miragon/pulse-engine-core';\nexport const cause = rootCause;\n",
  "package.json":
    '{ "name": "@miragon/pulse-orca", "private": true, "dependencies": { "@miragon/pulse-runtime-view": "workspace:*", "@miragon/pulse-engine-adapter": "workspace:*" } }\n',
}

const tree = new PlantedTree("apps/orca", PLANTED)

afterAll(() => {
  tree.dispose()
})

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    expect(tree.report()).toContain(
      "error not-in-allowed: apps/orca/src/editor/reads-node.ts → fs/promises No entry of `allowed` in apps/orca/.dependency-cruiser.cjs permits this import.",
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const at = (path: string): string => `apps/orca/${path}`
    const view = at("node_modules/@miragon/pulse-runtime-view/dist/core/index.d.ts")
    const adapter = at("node_modules/@miragon/pulse-engine-adapter/dist/index.d.ts")
    const engineCore = "@miragon/pulse-engine-core"
    expect(tree.violations()).toEqual(
      [
        `model-libraries-stay-in-the-model-adapter: ${at("src/editor/reads-model-library.ts")} -> bpmn-moddle`,
        `not-in-allowed: ${at("src/editor/reads-model-library.ts")} -> bpmn-moddle`,
        `not-in-allowed: ${at("src/editor/reads-node.ts")} -> fs/promises`,
        `not-in-allowed: ${at("src/panel/reaches-the-worker-api.ts")} -> orca/worker`,
        `not-in-allowed: ${at("src/panel/reaches-the-worker.ts")} -> ${at("src/worker/wires-the-view.ts")}`,
        `not-in-allowed: ${at("src/panel/runs-the-core.ts")} -> ${view}`,
        `not-in-allowed: ${at("src/worker/draws.ts")} -> orca`,
        `not-in-allowed: ${at("src/worker/not-the-root.ts")} -> ${adapter}`,
        `not-in-allowed: ${at("src/worker/runs-engine-core.ts")} -> ${engineCore}`,
        `not-to-unresolvable: ${at("src/editor/reads-model-library.ts")} -> bpmn-moddle`,
        `not-to-unresolvable: ${at("src/worker/runs-engine-core.ts")} -> ${engineCore}`,
        `not-to-unresolvable: ${at("test/worker/anything.test.ts")} -> ${engineCore}`,
        `plugin-is-engine-neutral: ${at("src/worker/runs-engine-core.ts")} -> ${engineCore}`,
        `plugin-is-engine-neutral: ${at("test/worker/anything.test.ts")} -> ${engineCore}`,
      ].sort(),
    )
  })
})
