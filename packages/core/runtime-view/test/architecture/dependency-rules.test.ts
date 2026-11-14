import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PLANTED: Readonly<Record<string, string>> = {
  "src/ports/ids.ts": "export const id = 1;\n",
  "src/ports/index.ts": "export * from './ids.ts';\n",
  "src/core/uses-node.ts":
    "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
  "src/core/deep-ports.ts": "export * from '../ports/ids.ts';\n",
  "src/core/through-the-entry.ts": "export * from '../ports/index.ts';\n",
  "src/core/cycle-a.ts": "import { b } from './cycle-b.ts';\nexport const a = () => b();\n",
  "src/core/cycle-b.ts": "import { a } from './cycle-a.ts';\nexport const b = () => a();\n",
  "src/core/index.ts": "export const coreValue = 1;\n",
  "src/core/protocol/index.ts": "export const protocolValue = 1;\n",
  "src/core/protocol/leaky.ts":
    "import { id } from '../../ports/index.ts';\nexport const leaked = id;\n",
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
  "src/ports/speaks-the-contract.ts":
    "import type { ProcessRuntime } from '@miragon/pulse-engine-core';\nexport type Runtime = ProcessRuntime;\n",
  "src/core/speaks-the-contract.ts":
    "import { RuntimeError } from '@miragon/pulse-engine-core';\nexport const error = RuntimeError;\n",
  "src/model/speaks-the-contract.ts":
    "import { BpmnProcessId } from '@miragon/pulse-engine-core';\nexport const id = BpmnProcessId;\n",
  "src/host-kit/speaks-the-contract.ts":
    "import { InstanceId } from '@miragon/pulse-engine-core';\nexport const id = InstanceId;\n",
  "src/webview/skips-the-protocol.ts":
    "import { RuntimeError } from '@miragon/pulse-engine-core';\nexport const error = RuntimeError;\n",
  "src/core/ships-the-fake.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "src/core/escapes-into-the-contract.ts":
    "import { RuntimeError } from '../../../../connectors/engine/engine-core/dist/index.js';\nexport const error = RuntimeError;\n",
  "../../connectors/engine/engine-core/dist/index.js": "export const RuntimeError = 1;\n",
  "test/core/runs-the-fake.test.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "test/core/escapes-into-the-fake.test.ts":
    "import { FakeEngine } from '../../../../connectors/engine/engine-core/src/testing/fake/fake-engine.ts';\nexport const fake = FakeEngine;\n",
  "../../connectors/engine/engine-core/src/testing/fake/fake-engine.ts":
    "export const FakeEngine = 1;\n",
  "src/core/runs-c7-core.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "test/core/runs-c7-core.test.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "src/host-kit/reads-c7-core-subpath.ts":
    "import { causeOf } from '@miragon/pulse-c7-core/cause';\nexport const cause = causeOf;\n",
  "test/core/escapes-into-c7-core.test.ts":
    "import { causeOf } from '../../../../connectors/c7/c7-core/src/cause.ts';\nexport const cause = causeOf;\n",
  "../../connectors/c7/c7-core/src/cause.ts": "export const causeOf = 1;\n",
  "../../../node_modules/@miragon/pulse-c7-core/package.json":
    '{ "name": "@miragon/pulse-c7-core", "exports": { ".": { "types": "./dist/index.d.ts" } } }\n',
  "../../../node_modules/@miragon/pulse-c7-core/dist/index.d.ts":
    "export declare const causeOf: number;\n",
  "src/host-kit/wires-the-adapter.ts":
    "import { C7Adapter } from '@miragon/pulse-c7-adapter';\nexport const adapter = C7Adapter;\n",
  "src/webview/reads-tones.ts":
    "import { SITUATION_TONES } from '@miragon/pulse-ui/tones';\nexport const tones = SITUATION_TONES;\n",
  "src/core/reads-tones.ts":
    "import type { ToneVariant } from '@miragon/pulse-ui/tones';\nexport type Tone = ToneVariant;\n",
  "src/host-kit/reads-tones.ts":
    "import { countTone } from '@miragon/pulse-ui/tones';\nexport const tone = countTone;\n",
  "src/core/views/labels.ts":
    "import { formatCount } from '@miragon/pulse-ui/format';\nexport const count = formatCount;\n",
  "src/webview/format/count-labels.ts":
    "import { formatCount } from '@miragon/pulse-ui/format';\nexport const count = formatCount;\n",
  "src/webview/reads-format.ts":
    "import { formatCount } from '@miragon/pulse-ui/format';\nexport const count = formatCount;\n",
  "src/core/reads-format.ts":
    "import { shortId } from '@miragon/pulse-ui/format';\nexport const short = shortId;\n",
  "src/core/escapes-into-format.ts":
    "import { shortId } from '../../../ui/src/format/text.ts';\nexport const short = shortId;\n",
  "src/webview/escapes-into-built-format.ts":
    "import { formatCount } from '../../../ui/dist/format/numbers.js';\nexport const count = formatCount;\n",
  "../ui/src/format/text.ts": "export const shortId = 1;\n",
  "../ui/dist/format/numbers.js": "export const formatCount = 1;\n",
  "src/webview/escapes-into-tones.ts":
    "import { countTone } from '../../../ui/src/tones/count-tone.ts';\nexport const tone = countTone;\n",
  "src/core/escapes-into-built-tones.ts":
    "import { countTone } from '../../../ui/dist/tones/count-tone.js';\nexport const tone = countTone;\n",
  "../ui/src/tones/count-tone.ts": "export const countTone = 1;\n",
  "../ui/dist/tones/count-tone.js": "export const countTone = 1;\n",
  "src/webview/renders-kit.ts":
    "import { Button } from '@miragon/pulse-ui';\nexport const button = Button;\n",
  "src/webview/reads-theme.ts":
    "import '@miragon/pulse-ui/theme.css';\nexport const themed = true;\n",
  "src/core/renders-kit.ts":
    "import { Button } from '@miragon/pulse-ui';\nexport const button = Button;\n",
  "src/core/reads-theme.ts": "import '@miragon/pulse-ui/theme.css';\nexport const themed = true;\n",
  "src/webview/reads-globals.ts":
    "import '@miragon/pulse-ui/globals.css';\nexport const themed = true;\n",
  "src/webview/escapes-into-kit.ts":
    "import { Button } from '../../../ui/src/index.ts';\nexport const button = Button;\n",
  "../ui/src/index.ts": "export const Button = 1;\n",
  "src/core/ships-ui-testing.ts":
    "import { PRODUCT_GLOSSARY } from '@miragon/pulse-ui/testing';\nexport const glossary = PRODUCT_GLOSSARY;\n",
  "src/webview/ships-ui-testing.ts":
    "import { PRODUCT_GLOSSARY } from '@miragon/pulse-ui/testing';\nexport const glossary = PRODUCT_GLOSSARY;\n",
  "src/webview/reads-kit-subpath.ts":
    "import { Button } from '@miragon/pulse-ui/kit';\nexport const button = Button;\n",
  "test/core/reads-ui-testing.test.ts":
    "import { PRODUCT_GLOSSARY } from '@miragon/pulse-ui/testing';\nexport const glossary = PRODUCT_GLOSSARY;\n",
  "src/host-kit/connections/reads-profiles.ts":
    "import { parseProfileFile } from '@miragon/pulse-profile';\nexport const parse = parseProfileFile;\n",
  "src/host-kit/panels/reads-profiles.ts":
    "import { parseProfileFile } from '@miragon/pulse-profile';\nexport const parse = parseProfileFile;\n",
  "src/webview/renders-widget-shell.ts":
    "import { ListTable } from '@miragon/pulse-widget-shell/widgets';\nexport const table = ListTable;\n",
  "src/webview/boots-widget-shell.ts":
    "import { createToolRegistrar } from '@miragon/pulse-widget-shell';\nexport const boot = createToolRegistrar;\n",
  "src/core/reads-profiles.ts":
    "import type { Profile } from '@miragon/pulse-profile';\nexport type Read = Profile;\n",
  "src/host-kit/connections/ships-profile-fixtures.ts":
    "import { PROFILE_FIXTURES } from '@miragon/pulse-profile/testing';\nexport const fixtures = PROFILE_FIXTURES;\n",
  "src/host-kit/connections/escapes-into-profile.ts":
    "import { parseProfileFile } from '../../../../profile/src/parse.ts';\nexport const parse = parseProfileFile;\n",
  "../profile/src/parse.ts": "export const parseProfileFile = 1;\n",
  "test/host-kit/reads-profile-fixtures.test.ts":
    "import { PROFILE_FIXTURES } from '@miragon/pulse-profile/testing';\nexport const fixtures = PROFILE_FIXTURES;\n",
  "src/webview/renders-react.tsx":
    "import { createRoot } from 'react-dom/client';\nimport { useState } from 'react';\nimport { XIcon } from 'lucide-react';\nexport const parts = [createRoot, useState, XIcon];\n",
  "src/core/renders-react.ts":
    "import { useState } from 'react';\nexport const state = useState;\n",
  "src/webview/renders-preact.ts":
    "import { render } from 'preact';\nexport const draw = render;\n",
  "../../../node_modules/preact/package.json":
    '{ "name": "preact", "exports": { ".": { "types": "./index.d.ts" } } }\n',
  "../../../node_modules/preact/index.d.ts": "export declare const render: number;\n",
  "src/webview/reads-radix.ts": "import { Tabs } from 'radix-ui';\nexport const tabs = Tabs;\n",
  "../../../node_modules/radix-ui/package.json":
    '{ "name": "radix-ui", "exports": { ".": { "types": "./index.d.ts" } } }\n',
  "../../../node_modules/radix-ui/index.d.ts": "export declare const Tabs: number;\n",
  "package.json":
    '{ "name": "@miragon/pulse-runtime-view", "private": true, "dependencies": { "@miragon/pulse-c7-core": "workspace:*", "@miragon/pulse-engine-core": "workspace:*", "@miragon/pulse-profile": "workspace:*", "@miragon/pulse-ui": "workspace:*", "bpmn-moddle": "10.3.1", "lucide-react": "1.70.0", "react": "19.3.1", "react-dom": "19.3.1" } }\n',
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
    const engineCore = at("node_modules/@miragon/pulse-engine-core/dist/index.d.ts")
    const engineCoreTesting = at("node_modules/@miragon/pulse-engine-core/dist/testing/index.d.ts")
    const kit = at("node_modules/@miragon/pulse-ui/dist/index.d.ts")
    const kitTesting = at("node_modules/@miragon/pulse-ui/dist/testing/index.d.ts")
    const theme = at("node_modules/@miragon/pulse-ui/src/theme.css")
    const globals = at("node_modules/@miragon/pulse-ui/src/globals.css")
    const tones = at("node_modules/@miragon/pulse-ui/dist/tones/index.d.ts")
    const format = at("node_modules/@miragon/pulse-ui/dist/format/index.d.ts")
    const profile = at("node_modules/@miragon/pulse-profile/dist/index.d.ts")
    const profileTesting = at("node_modules/@miragon/pulse-profile/dist/testing/index.d.ts")
    const c7Core = "node_modules/@miragon/pulse-c7-core/dist/index.d.ts"
    const c7CoreSubpath = "@miragon/pulse-c7-core/cause"
    const c7CoreSource = "packages/connectors/c7/c7-core/src/cause.ts"
    const tonesSource = "packages/core/ui/src/tones/count-tone.ts"
    const tonesBuild = "packages/core/ui/dist/tones/count-tone.js"
    const adapter = "@miragon/pulse-c7-adapter"
    expect(tree.violations()).toEqual(
      [
        `model-libraries-stay-in-the-model-adapter: ${at("src/host-kit/reads-model-library.ts")} -> ${moddle}`,
        `no-circular: ${at("src/core/cycle-a.ts")} -> ${at("src/core/cycle-b.ts")}`,
        `not-in-allowed: ${at("src/core/deep-ports.ts")} -> ${at("src/ports/ids.ts")}`,
        `not-in-allowed: ${at("src/core/uses-node.ts")} -> fs`,
        `not-in-allowed: ${at("src/host-kit/imports-vscode.ts")} -> vscode`,
        `not-in-allowed: ${at("src/host-kit/reads-model-library.ts")} -> ${moddle}`,
        `not-in-allowed: ${at("src/webview/runtime-import.ts")} -> ${at("src/core/protocol/index.ts")}`,
        `not-to-unresolvable: ${at("src/host-kit/imports-vscode.ts")} -> vscode`,
        `protocol-imports-nothing: ${at("src/core/protocol/leaky.ts")} -> ${at("src/ports/index.ts")}`,
        `not-in-allowed: ${at("src/webview/skips-the-protocol.ts")} -> ${engineCore}`,
        `not-in-allowed: ${at("src/core/ships-the-fake.ts")} -> ${engineCoreTesting}`,
        `engine-core-only-by-its-entries: ${at("src/core/escapes-into-the-contract.ts")} -> packages/connectors/engine/engine-core/dist/index.js`,
        `not-in-allowed: ${at("src/core/escapes-into-the-contract.ts")} -> packages/connectors/engine/engine-core/dist/index.js`,
        `engine-core-only-by-its-entries: ${at("test/core/escapes-into-the-fake.test.ts")} -> packages/connectors/engine/engine-core/src/testing/fake/fake-engine.ts`,
        `runtime-view-is-dialect-neutral: ${at("src/core/runs-c7-core.ts")} -> ${c7Core}`,
        `not-in-allowed: ${at("src/core/runs-c7-core.ts")} -> ${c7Core}`,
        `runtime-view-is-dialect-neutral: ${at("test/core/runs-c7-core.test.ts")} -> ${c7Core}`,
        `runtime-view-is-dialect-neutral: ${at("src/host-kit/reads-c7-core-subpath.ts")} -> ${c7CoreSubpath}`,
        `not-in-allowed: ${at("src/host-kit/reads-c7-core-subpath.ts")} -> ${c7CoreSubpath}`,
        `not-to-unresolvable: ${at("src/host-kit/reads-c7-core-subpath.ts")} -> ${c7CoreSubpath}`,
        `runtime-view-is-dialect-neutral: ${at("test/core/escapes-into-c7-core.test.ts")} -> ${c7CoreSource}`,
        `runtime-view-is-dialect-neutral: ${at("src/host-kit/wires-the-adapter.ts")} -> ${adapter}`,
        `not-in-allowed: ${at("src/host-kit/wires-the-adapter.ts")} -> ${adapter}`,
        `not-to-unresolvable: ${at("src/host-kit/wires-the-adapter.ts")} -> ${adapter}`,
        `not-in-allowed: ${at("src/host-kit/reads-tones.ts")} -> ${tones}`,
        `not-in-allowed: ${at("src/webview/reads-format.ts")} -> ${format}`,
        `not-in-allowed: ${at("src/core/reads-format.ts")} -> ${format}`,
        `pulse-ui-only-its-foundation: ${at("src/core/escapes-into-format.ts")} -> packages/core/ui/src/format/text.ts`,
        `not-in-allowed: ${at("src/core/escapes-into-format.ts")} -> packages/core/ui/src/format/text.ts`,
        `webview-pulse-ui-by-its-entries: ${at("src/webview/escapes-into-built-format.ts")} -> packages/core/ui/dist/format/numbers.js`,
        `not-in-allowed: ${at("src/webview/escapes-into-built-format.ts")} -> packages/core/ui/dist/format/numbers.js`,
        `webview-pulse-ui-by-its-entries: ${at("src/webview/escapes-into-tones.ts")} -> ${tonesSource}`,
        `not-in-allowed: ${at("src/webview/escapes-into-tones.ts")} -> ${tonesSource}`,
        `pulse-ui-only-its-foundation: ${at("src/core/escapes-into-built-tones.ts")} -> ${tonesBuild}`,
        `not-in-allowed: ${at("src/core/escapes-into-built-tones.ts")} -> ${tonesBuild}`,
        `webview-pulse-ui-by-its-entries: ${at("src/webview/escapes-into-kit.ts")} -> packages/core/ui/src/index.ts`,
        `not-in-allowed: ${at("src/webview/escapes-into-kit.ts")} -> packages/core/ui/src/index.ts`,
        `pulse-ui-only-its-foundation: ${at("src/core/renders-kit.ts")} -> ${kit}`,
        `not-in-allowed: ${at("src/core/renders-kit.ts")} -> ${kit}`,
        `pulse-ui-only-its-foundation: ${at("src/core/reads-theme.ts")} -> ${theme}`,
        `not-in-allowed: ${at("src/core/reads-theme.ts")} -> ${theme}`,
        `webview-pulse-ui-by-its-entries: ${at("src/webview/reads-globals.ts")} -> ${globals}`,
        `not-in-allowed: ${at("src/webview/reads-globals.ts")} -> ${globals}`,
        `pulse-ui-only-its-foundation: ${at("src/core/ships-ui-testing.ts")} -> ${kitTesting}`,
        `not-in-allowed: ${at("src/core/ships-ui-testing.ts")} -> ${kitTesting}`,
        `webview-pulse-ui-by-its-entries: ${at("src/webview/ships-ui-testing.ts")} -> ${kitTesting}`,
        `not-in-allowed: ${at("src/webview/ships-ui-testing.ts")} -> ${kitTesting}`,
        `webview-pulse-ui-by-its-entries: ${at("src/webview/reads-kit-subpath.ts")} -> @miragon/pulse-ui/kit`,
        `not-in-allowed: ${at("src/webview/reads-kit-subpath.ts")} -> @miragon/pulse-ui/kit`,
        `not-to-unresolvable: ${at("src/webview/reads-kit-subpath.ts")} -> @miragon/pulse-ui/kit`,
        `webview-never-widget-shell: ${at("src/webview/renders-widget-shell.ts")} -> @miragon/pulse-widget-shell/widgets`,
        `not-in-allowed: ${at("src/webview/renders-widget-shell.ts")} -> @miragon/pulse-widget-shell/widgets`,
        `not-to-unresolvable: ${at("src/webview/renders-widget-shell.ts")} -> @miragon/pulse-widget-shell/widgets`,
        `webview-never-widget-shell: ${at("src/webview/boots-widget-shell.ts")} -> @miragon/pulse-widget-shell`,
        `not-in-allowed: ${at("src/webview/boots-widget-shell.ts")} -> @miragon/pulse-widget-shell`,
        `not-to-unresolvable: ${at("src/webview/boots-widget-shell.ts")} -> @miragon/pulse-widget-shell`,
        `not-in-allowed: ${at("src/host-kit/panels/reads-profiles.ts")} -> ${profile}`,
        `not-in-allowed: ${at("src/core/reads-profiles.ts")} -> ${profile}`,
        `not-in-allowed: ${at("src/host-kit/connections/ships-profile-fixtures.ts")} -> ${profileTesting}`,
        `not-in-allowed: ${at("src/host-kit/connections/escapes-into-profile.ts")} -> packages/core/profile/src/parse.ts`,
        `not-in-allowed: ${at("src/core/renders-react.ts")} -> ${at("node_modules/react/index.js")}`,
        `not-in-allowed: ${at("src/webview/renders-preact.ts")} -> node_modules/preact/index.d.ts`,
        `no-undeclared-dependencies: ${at("src/webview/renders-preact.ts")} -> node_modules/preact/index.d.ts`,
        `not-in-allowed: ${at("src/webview/reads-radix.ts")} -> node_modules/radix-ui/index.d.ts`,
        `no-undeclared-dependencies: ${at("src/webview/reads-radix.ts")} -> node_modules/radix-ui/index.d.ts`,
      ].sort(),
    )
  })
})
