import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PACKAGE = "packages/connectors/c8/c8-adapter"
const MANIFEST =
  '{ "name": "@miragon/pulse-c8-adapter", "private": true, "dependencies": { "@miragon/pulse-engine-core": "workspace:*", "@miragon/pulse-http": "workspace:*", "@miragon/pulse-runtime-view": "workspace:*" } }\n'

const ADAPTER: Readonly<Record<string, string>> = {
  "src/index.ts":
    "import type { ProcessRuntime } from '@miragon/pulse-engine-core';\nimport type { EngineConnection } from '@miragon/pulse-runtime-view/ports';\nexport type Runtime = ProcessRuntime | EngineConnection;\n",
  "src/reading/uses-node.ts":
    "import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n",
  "src/ships-engine-core-testing.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "src/reads-the-core.ts":
    "import { BoardParser } from '@miragon/pulse-runtime-view/core';\nexport const parser = BoardParser;\n",
  "src/reads-the-c7-core.ts":
    "import { causeOf } from '@miragon/pulse-c7-core';\nexport const cause = causeOf;\n",
  "src/wire/sends.ts":
    "import { createHttp } from '@miragon/pulse-http';\nexport const send = createHttp;\n",
  "src/wire/asks-for-tokens.ts":
    "import { clientCredentialsTokens } from '@miragon/pulse-http/oauth';\nexport const tokens = clientCredentialsTokens;\n",
  "src/wire/sends-a-test-engine.ts":
    "import { startCaseEngine } from '@miragon/pulse-http/testing/loopback';\nexport const engine = startCaseEngine;\n",
  "src/wire/reads-an-unexported-file.ts":
    "import { attempt } from '@miragon/pulse-http/attempt';\nexport const tried = attempt;\n",
  "src/wire/escapes-into-http.ts":
    "import { createHttp } from '../../../../../core/http/src/http.ts';\nexport const send = createHttp;\n",
  "src/rest/sends-itself.ts":
    "import { createHttp } from '@miragon/pulse-http';\nexport const send = createHttp;\n",
  "src/errors/asks-for-tokens.ts":
    "import { clientCredentialsTokens } from '@miragon/pulse-http/oauth';\nexport const tokens = clientCredentialsTokens;\n",
  "../../../core/http/src/http.ts": "export const createHttp = 1;\n",
  "test/wire/sends.test.ts":
    "import { createHttp } from '@miragon/pulse-http';\nimport { TRANSPORT_CASES } from '@miragon/pulse-http/testing';\nexport const both = [createHttp, TRANSPORT_CASES];\n",
  "test/c8.engine.test.ts":
    "import type { Runtime } from '../src/index.ts';\nexport type Unproven = Runtime;\n",
  "package.json": MANIFEST,
}

const adapter = new PlantedTree(PACKAGE, ADAPTER)

afterAll(() => {
  adapter.dispose()
})

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    expect(adapter.report()).toContain(
      `error not-in-allowed: ${PACKAGE}/src/reading/uses-node.ts → fs/promises No entry of \`allowed\` in ${PACKAGE}/.dependency-cruiser.cjs permits this import.`,
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const at = (path: string): string => `${PACKAGE}/${path}`
    const view = at("node_modules/@miragon/pulse-runtime-view/dist/core/index.d.ts")
    const testing = at("node_modules/@miragon/pulse-engine-core/dist/testing/index.d.ts")
    const http = at("node_modules/@miragon/pulse-http/dist/index.d.ts")
    const oauth = at("node_modules/@miragon/pulse-http/dist/oauth/index.d.ts")
    const loopback = at("node_modules/@miragon/pulse-http/dist/testing/loopback/index.d.ts")
    const httpSubpath = "@miragon/pulse-http/attempt"
    const httpSource = "packages/core/http/src/http.ts"
    expect(adapter.violations()).toEqual([
      `engine-test-runs-the-conformance-kit: ${at("test/c8.engine.test.ts")} -> ${at("test/c8.engine.test.ts")}`,
      `http-by-its-entries: ${at("src/wire/escapes-into-http.ts")} -> ${httpSource}`,
      `http-by-its-entries: ${at("src/wire/reads-an-unexported-file.ts")} -> ${httpSubpath}`,
      `http-by-its-entries: ${at("src/wire/sends-a-test-engine.ts")} -> ${loopback}`,
      `http-only-in-the-wire: ${at("src/errors/asks-for-tokens.ts")} -> ${oauth}`,
      `http-only-in-the-wire: ${at("src/rest/sends-itself.ts")} -> ${http}`,
      `not-in-allowed: ${at("src/errors/asks-for-tokens.ts")} -> ${oauth}`,
      `not-in-allowed: ${at("src/reading/uses-node.ts")} -> fs/promises`,
      `not-in-allowed: ${at("src/reads-the-c7-core.ts")} -> @miragon/pulse-c7-core`,
      `not-in-allowed: ${at("src/reads-the-core.ts")} -> ${view}`,
      `not-in-allowed: ${at("src/rest/sends-itself.ts")} -> ${http}`,
      `not-in-allowed: ${at("src/ships-engine-core-testing.ts")} -> ${testing}`,
      `not-in-allowed: ${at("src/wire/escapes-into-http.ts")} -> ${httpSource}`,
      `not-in-allowed: ${at("src/wire/reads-an-unexported-file.ts")} -> ${httpSubpath}`,
      `not-in-allowed: ${at("src/wire/sends-a-test-engine.ts")} -> ${loopback}`,
      `not-to-unresolvable: ${at("src/reads-the-c7-core.ts")} -> @miragon/pulse-c7-core`,
      `not-to-unresolvable: ${at("src/wire/reads-an-unexported-file.ts")} -> ${httpSubpath}`,
    ])
  })
})
