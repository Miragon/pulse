import { execFileSync, spawnSync } from "node:child_process"
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
  "src/adapters/c7/runs-c7-core.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "src/adapters/c7/ships-c7-core-testing.ts":
    "import { pageQuery } from '@miragon/pulse-c7-core/testing';\nexport const page = pageQuery;\n",
  "src/adapters/other/runs-c7-core.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "src/core/runs-c7-core.ts":
    "import type { WaitState } from '@miragon/pulse-c7-core';\nexport type Wait = WaitState;\n",
  "src/host/reads-c7-core-subpath.ts":
    "import { causeOf } from '@miragon/pulse-c7-core/cause';\nexport const cause = causeOf;\n",
  "test/adapters/c7/c7-core.test.ts":
    "import { pageQuery } from '@miragon/pulse-c7-core/testing';\nexport const page = pageQuery;\n",
  "test/adapters/c7-other/c7-core.test.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "test/core/c7-core.test.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "test/core/escapes-into-c7-core.test.ts":
    "import { causeOf } from '../../../../packages/connectors/c7/c7-core/src/cause.ts';\nexport const cause = causeOf;\n",
  "../../packages/connectors/c7/c7-core/src/cause.ts": "export const causeOf = 1;\n",
  "src/webview/reads-tones.ts":
    "import { SITUATION_TONES } from '@miragon/pulse-ui/tones';\nexport const tones = SITUATION_TONES;\n",
  "src/core/reads-tones.ts":
    "import type { ToneVariant } from '@miragon/pulse-ui/tones';\nexport type Tone = ToneVariant;\n",
  "src/host/reads-tones.ts":
    "import { countTone } from '@miragon/pulse-ui/tones';\nexport const tone = countTone;\n",
  "src/core/views/labels.ts":
    "import { formatCount } from '@miragon/pulse-ui/format';\nexport const count = formatCount;\n",
  "src/webview/format/count-labels.ts":
    "import { formatCount } from '@miragon/pulse-ui/format';\nexport const count = formatCount;\n",
  "src/webview/reads-format.ts":
    "import { formatCount } from '@miragon/pulse-ui/format';\nexport const count = formatCount;\n",
  "src/core/reads-format.ts":
    "import { shortId } from '@miragon/pulse-ui/format';\nexport const short = shortId;\n",
  "src/host/reads-format.ts":
    "import { formatDuration } from '@miragon/pulse-ui/format';\nexport const duration = formatDuration;\n",
  "src/core/escapes-into-format.ts":
    "import { shortId } from '../../../../packages/core/ui/src/format/text.ts';\nexport const short = shortId;\n",
  "src/webview/escapes-into-built-format.ts":
    "import { formatCount } from '../../../../packages/core/ui/dist/format/numbers.js';\nexport const count = formatCount;\n",
  "../../packages/core/ui/src/format/text.ts": "export const shortId = 1;\n",
  "../../packages/core/ui/dist/format/numbers.js": "export const formatCount = 1;\n",
  "src/webview/renders-kit.ts":
    "import { Button } from '@miragon/pulse-ui';\nexport const button = Button;\n",
  "src/core/ships-ui-testing.ts":
    "import { PRODUCT_GLOSSARY } from '@miragon/pulse-ui/testing';\nexport const glossary = PRODUCT_GLOSSARY;\n",
  "src/webview/reads-kit-subpath.ts":
    "import { Button } from '@miragon/pulse-ui/kit';\nexport const button = Button;\n",
  "src/webview/escapes-into-tones.ts":
    "import { countTone } from '../../../../packages/core/ui/src/tones/count-tone.ts';\nexport const tone = countTone;\n",
  "src/core/escapes-into-built-tones.ts":
    "import { countTone } from '../../../../packages/core/ui/dist/tones/count-tone.js';\nexport const tone = countTone;\n",
  "../../packages/core/ui/src/tones/count-tone.ts": "export const countTone = 1;\n",
  "../../packages/core/ui/dist/tones/count-tone.js": "export const countTone = 1;\n",
  "test/core/reads-ui-testing.test.ts":
    "import { PRODUCT_GLOSSARY } from '@miragon/pulse-ui/testing';\nexport const glossary = PRODUCT_GLOSSARY;\n",
  "src/contract/reads-engine-contract.ts":
    "import { RuntimeError } from '@miragon/pulse-engine-contract';\nexport const error = RuntimeError;\n",
  "src/contract/ships-the-kit.ts":
    "import { ConformanceKit } from '@miragon/pulse-engine-contract/testing';\nexport const kit = ConformanceKit;\n",
  "src/core/skips-the-contract.ts":
    "import { RuntimeError } from '@miragon/pulse-engine-contract';\nexport const error = RuntimeError;\n",
  "src/adapters/c7/skips-the-contract.ts":
    "import { RuntimeError } from '@miragon/pulse-engine-contract';\nexport const error = RuntimeError;\n",
  "src/host/ships-the-fake.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-contract/testing';\nexport const fake = FakeEngine;\n",
  "test/adapters/c7/c7-kit.engine.test.ts":
    "import { adapter } from '../../../src/adapters/c7/index.ts';\nimport { ConformanceKit } from '@miragon/pulse-engine-contract/testing';\nexport const proven = [adapter, ConformanceKit];\n",
  "test/core/runs-the-fake.test.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-contract/testing';\nexport const fake = FakeEngine;\n",
  "test/core/escapes-into-the-fake.test.ts":
    "import { FakeEngine } from '../../../../packages/core/engine-contract/src/testing/fake/fake-engine.ts';\nexport const fake = FakeEngine;\n",
  "dev/host/escapes-into-the-contract.ts":
    "import { RuntimeError } from '../../../../packages/core/engine-contract/dist/index.js';\nexport const error = RuntimeError;\n",
  "../../packages/core/engine-contract/src/testing/fake/fake-engine.ts":
    "export const FakeEngine = 1;\n",
  "../../packages/core/engine-contract/dist/index.js": "export const RuntimeError = 1;\n",
  "package.json":
    '{ "name": "pulse", "private": true, "dependencies": { "@miragon/pulse-c7-core": "workspace:*", "@miragon/pulse-engine-contract": "workspace:*", "@miragon/pulse-ui": "workspace:*" } }\n',
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

const DEPCRUISE = join(REPO_ROOT, "node_modules/.bin/depcruise")

function cruiseArguments(outputType: string): string[] {
  return [
    "apps/vscode/src",
    "apps/vscode/test",
    "apps/vscode/dev",
    "--config",
    join(APP_ROOT, ".dependency-cruiser.cjs"),
    "--output-type",
    outputType,
  ]
}

function violationsIn(root: string): string[] {
  const output = execFileSync(DEPCRUISE, cruiseArguments("json"), { cwd: root, encoding: "utf8" })
  const result = JSON.parse(output) as { summary: { violations: Violation[] } }
  return result.summary.violations.map(
    (violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`,
  )
}

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    const { stdout } = spawnSync(DEPCRUISE, cruiseArguments("err-long"), {
      cwd: plantedTree(),
      encoding: "utf8",
    })
    expect(stdout.replace(/\s+/g, " ")).toContain(
      "error not-in-allowed: apps/vscode/src/core/uses-node.ts → fs No entry of `allowed` in apps/vscode/.dependency-cruiser.cjs permits this import. Move the code to the layer that may make it (table 'Where code goes' in apps/vscode/CLAUDE.md)",
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const library = "apps/vscode/node_modules/bpmn-moddle/dist/index.js"
    const c7Core = "apps/vscode/node_modules/@miragon/pulse-c7-core/dist/index.d.ts"
    const c7CoreTesting = "apps/vscode/node_modules/@miragon/pulse-c7-core/dist/testing/index.d.ts"
    const kit = "apps/vscode/node_modules/@miragon/pulse-ui/dist/index.d.ts"
    const kitTesting = "apps/vscode/node_modules/@miragon/pulse-ui/dist/testing/index.d.ts"
    const tones = "apps/vscode/node_modules/@miragon/pulse-ui/dist/tones/index.d.ts"
    const tonesSource = "packages/core/ui/src/tones/count-tone.ts"
    const tonesBuild = "packages/core/ui/dist/tones/count-tone.js"
    const format = "apps/vscode/node_modules/@miragon/pulse-ui/dist/format/index.d.ts"
    const formatSource = "packages/core/ui/src/format/text.ts"
    const formatBuild = "packages/core/ui/dist/format/numbers.js"
    const engineContract = "apps/vscode/node_modules/@miragon/pulse-engine-contract/dist/index.d.ts"
    const engineContractTesting =
      "apps/vscode/node_modules/@miragon/pulse-engine-contract/dist/testing/index.d.ts"
    expect(violationsIn(plantedTree()).sort()).toEqual(
      [
        `c7-core-only-in-the-c7-adapter: apps/vscode/src/adapters/other/runs-c7-core.ts -> ${c7Core}`,
        `c7-core-only-in-the-c7-adapter: apps/vscode/src/core/runs-c7-core.ts -> ${c7Core}`,
        `c7-core-only-in-the-c7-adapter: apps/vscode/test/adapters/c7-other/c7-core.test.ts -> ${c7Core}`,
        `c7-core-only-in-the-c7-adapter: apps/vscode/test/core/c7-core.test.ts -> ${c7Core}`,
        "c7-core-only-in-the-c7-adapter: apps/vscode/test/core/escapes-into-c7-core.test.ts -> packages/connectors/c7/c7-core/src/cause.ts",
        "c7-core-only-in-the-c7-adapter: apps/vscode/src/host/reads-c7-core-subpath.ts -> @miragon/pulse-c7-core/cause",
        "not-in-allowed: apps/vscode/src/host/reads-c7-core-subpath.ts -> @miragon/pulse-c7-core/cause",
        "not-to-unresolvable: apps/vscode/src/host/reads-c7-core-subpath.ts -> @miragon/pulse-c7-core/cause",
        `not-in-allowed: apps/vscode/src/adapters/c7/ships-c7-core-testing.ts -> ${c7CoreTesting}`,
        `not-in-allowed: apps/vscode/src/adapters/other/runs-c7-core.ts -> ${c7Core}`,
        `not-in-allowed: apps/vscode/src/core/runs-c7-core.ts -> ${c7Core}`,
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
        `not-in-allowed: apps/vscode/src/host/reads-tones.ts -> ${tones}`,
        `pulse-ui-only-its-foundation: apps/vscode/src/webview/renders-kit.ts -> ${kit}`,
        `not-in-allowed: apps/vscode/src/webview/renders-kit.ts -> ${kit}`,
        `pulse-ui-only-its-foundation: apps/vscode/src/core/ships-ui-testing.ts -> ${kitTesting}`,
        `not-in-allowed: apps/vscode/src/core/ships-ui-testing.ts -> ${kitTesting}`,
        "pulse-ui-only-its-foundation: apps/vscode/src/webview/reads-kit-subpath.ts -> @miragon/pulse-ui/kit",
        "not-in-allowed: apps/vscode/src/webview/reads-kit-subpath.ts -> @miragon/pulse-ui/kit",
        "not-to-unresolvable: apps/vscode/src/webview/reads-kit-subpath.ts -> @miragon/pulse-ui/kit",
        `pulse-ui-only-its-foundation: apps/vscode/src/webview/escapes-into-tones.ts -> ${tonesSource}`,
        `not-in-allowed: apps/vscode/src/webview/escapes-into-tones.ts -> ${tonesSource}`,
        `pulse-ui-only-its-foundation: apps/vscode/src/core/escapes-into-built-tones.ts -> ${tonesBuild}`,
        `not-in-allowed: apps/vscode/src/core/escapes-into-built-tones.ts -> ${tonesBuild}`,
        `not-in-allowed: apps/vscode/src/host/reads-format.ts -> ${format}`,
        `not-in-allowed: apps/vscode/src/core/reads-format.ts -> ${format}`,
        `not-in-allowed: apps/vscode/src/webview/reads-format.ts -> ${format}`,
        `pulse-ui-only-its-foundation: apps/vscode/src/core/escapes-into-format.ts -> ${formatSource}`,
        `not-in-allowed: apps/vscode/src/core/escapes-into-format.ts -> ${formatSource}`,
        `pulse-ui-only-its-foundation: apps/vscode/src/webview/escapes-into-built-format.ts -> ${formatBuild}`,
        `not-in-allowed: apps/vscode/src/webview/escapes-into-built-format.ts -> ${formatBuild}`,
        `not-in-allowed: apps/vscode/src/contract/ships-the-kit.ts -> ${engineContractTesting}`,
        `not-in-allowed: apps/vscode/src/core/skips-the-contract.ts -> ${engineContract}`,
        `not-in-allowed: apps/vscode/src/adapters/c7/skips-the-contract.ts -> ${engineContract}`,
        `not-in-allowed: apps/vscode/src/host/ships-the-fake.ts -> ${engineContractTesting}`,
        "engine-contract-only-by-its-entries: apps/vscode/test/core/escapes-into-the-fake.test.ts -> packages/core/engine-contract/src/testing/fake/fake-engine.ts",
        "engine-contract-only-by-its-entries: apps/vscode/dev/host/escapes-into-the-contract.ts -> packages/core/engine-contract/dist/index.js",
      ].sort(),
    )
  })
})
