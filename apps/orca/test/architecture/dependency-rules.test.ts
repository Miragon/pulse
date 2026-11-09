import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PLANTED: Readonly<Record<string, string>> = {
  "src/protocol.ts":
    "import type { StateMessage } from '@miragon/pulse-runtime-view/protocol';\nexport type Message = StateMessage;\n",
  "src/worker/wires-the-view.ts":
    "import { PanelTitle } from '@miragon/pulse-runtime-view/host-kit';\nimport type { OrcaWorkerApi } from 'orca/worker';\nimport { readFile } from 'node:fs/promises';\nimport type { Message } from '../protocol.ts';\nexport type Api = OrcaWorkerApi | Message;\nexport const used = [PanelTitle, readFile];\n",
  "src/worker/composition-root.ts":
    "import { C7Adapter } from '@miragon/pulse-c7-adapter';\nimport { BpmnModelSource } from '@miragon/pulse-runtime-view/model';\nexport const wired = [C7Adapter, BpmnModelSource];\n",
  "src/worker/not-the-root.ts":
    "import { C7Adapter } from '@miragon/pulse-c7-adapter';\nexport const wired = C7Adapter;\n",
  "src/worker/draws.ts": "import { Text } from 'orca';\nexport const text = Text;\n",
  "src/worker/names-an-id.ts":
    "import { InstanceId } from '@miragon/pulse-engine-core';\nimport type { WorkspaceFiles } from '@miragon/pulse-runtime-view/ports';\nexport type Files = WorkspaceFiles;\nexport const id = InstanceId;\n",
  "src/worker/ships-the-fake.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "src/panel/names-an-id.ts":
    "import { InstanceId } from '@miragon/pulse-engine-core';\nexport const id = InstanceId;\n",
  "src/worker/escapes-into-the-contract.ts":
    "import { RuntimeError } from '../../../../packages/connectors/engine/engine-core/dist/index.js';\nexport const error = RuntimeError;\n",
  "../../packages/connectors/engine/engine-core/dist/index.js": "export const RuntimeError = 1;\n",
  "src/worker/runs-c7-core.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "src/worker/reads-c7-core-subpath.ts":
    "import { causeOf } from '@miragon/pulse-c7-core/cause';\nexport const cause = causeOf;\n",
  "test/worker/escapes-into-c7-core.test.ts":
    "import { causeOf } from '../../../../packages/connectors/c7/c7-core/src/cause.ts';\nexport const cause = causeOf;\n",
  "../../packages/connectors/c7/c7-core/src/cause.ts": "export const causeOf = 1;\n",
  "../../node_modules/@miragon/pulse-c7-core/package.json":
    '{ "name": "@miragon/pulse-c7-core", "exports": { ".": { "types": "./dist/index.d.ts" } } }\n',
  "../../node_modules/@miragon/pulse-c7-core/dist/index.d.ts":
    "export declare const causeOf: number;\n",
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
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "package.json":
    '{ "name": "@miragon/pulse-orca", "private": true, "dependencies": { "@miragon/pulse-runtime-view": "workspace:*", "@miragon/pulse-c7-adapter": "workspace:*", "@miragon/pulse-engine-core": "workspace:*", "@miragon/pulse-c7-core": "workspace:*" } }\n',
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
    const adapter = at("node_modules/@miragon/pulse-c7-adapter/dist/index.d.ts")
    const engineCore = at("node_modules/@miragon/pulse-engine-core/dist/index.d.ts")
    const engineCoreTesting = at("node_modules/@miragon/pulse-engine-core/dist/testing/index.d.ts")
    const contractBuild = "packages/connectors/engine/engine-core/dist/index.js"
    const c7Core = "node_modules/@miragon/pulse-c7-core/dist/index.d.ts"
    const c7CoreSubpath = "@miragon/pulse-c7-core/cause"
    const c7CoreSource = "packages/connectors/c7/c7-core/src/cause.ts"
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
        `not-in-allowed: ${at("src/worker/ships-the-fake.ts")} -> ${engineCoreTesting}`,
        `not-in-allowed: ${at("src/panel/names-an-id.ts")} -> ${engineCore}`,
        `engine-core-only-by-its-entries: ${at("src/worker/escapes-into-the-contract.ts")} -> ${contractBuild}`,
        `not-in-allowed: ${at("src/worker/escapes-into-the-contract.ts")} -> ${contractBuild}`,
        `plugin-is-dialect-neutral: ${at("src/worker/runs-c7-core.ts")} -> ${c7Core}`,
        `not-in-allowed: ${at("src/worker/runs-c7-core.ts")} -> ${c7Core}`,
        `plugin-is-dialect-neutral: ${at("src/worker/reads-c7-core-subpath.ts")} -> ${c7CoreSubpath}`,
        `not-in-allowed: ${at("src/worker/reads-c7-core-subpath.ts")} -> ${c7CoreSubpath}`,
        `not-to-unresolvable: ${at("src/worker/reads-c7-core-subpath.ts")} -> ${c7CoreSubpath}`,
        `plugin-is-dialect-neutral: ${at("test/worker/escapes-into-c7-core.test.ts")} -> ${c7CoreSource}`,
        `not-to-unresolvable: ${at("src/editor/reads-model-library.ts")} -> bpmn-moddle`,
      ].sort(),
    )
  })
})
