import { afterAll, describe, expect, test } from "vitest"
import { PlantedTree } from "./support/planted-tree.js"

const PACKAGE = "packages/connectors/c7/c7-adapter"
const MANIFEST =
  '{ "name": "@miragon/pulse-c7-adapter", "private": true, "dependencies": { "@miragon/pulse-c7-core": "workspace:*", "@miragon/pulse-engine-core": "workspace:*", "@miragon/pulse-http": "workspace:*", "@miragon/pulse-runtime-view": "workspace:*" } }\n'

const ADAPTER: Readonly<Record<string, string>> = {
  "src/index.ts":
    "import type { ProcessRuntime } from '@miragon/pulse-engine-core';\nimport type { EngineAdapter } from '@miragon/pulse-runtime-view/ports';\nimport { causeOf } from '@miragon/pulse-c7-core';\nexport type Runtime = ProcessRuntime | EngineAdapter;\nexport const adapter = causeOf;\n",
  "src/mapping-uses-node.ts":
    "import { spawn } from 'node:child_process';\nexport const run = spawn;\n",
  "src/ships-engine-core-testing.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nexport const fake = FakeEngine;\n",
  "src/ships-c7-core-testing.ts":
    "import { pageQuery } from '@miragon/pulse-c7-core/testing';\nexport const page = pageQuery;\n",
  "src/reads-c7-routes.ts":
    "import { routeOf } from '@miragon/pulse-c7-core/routes';\nexport const route = routeOf;\n",
  "src/reads-the-core.ts":
    "import { BoardParser } from '@miragon/pulse-runtime-view/core';\nexport const parser = BoardParser;\n",
  "src/reads-the-client.ts":
    "import { createEngineClient } from '@miragon/pulse-c7-client';\nexport const client = createEngineClient;\n",
  "src/engine-rest/http/sends.ts":
    "import { createHttp } from '@miragon/pulse-http';\nexport const send = createHttp;\n",
  "src/engine-rest/http/sends-a-test-engine.ts":
    "import { startCaseEngine } from '@miragon/pulse-http/testing/loopback';\nexport const engine = startCaseEngine;\n",
  "src/engine-rest/http/reads-an-unexported-file.ts":
    "import { attempt } from '@miragon/pulse-http/attempt';\nexport const tried = attempt;\n",
  "src/engine-rest/http/escapes-into-http.ts":
    "import { createHttp } from '../../../../../../core/http/src/http.ts';\nexport const send = createHttp;\n",
  "src/reading/sends-itself.ts":
    "import { createHttp } from '@miragon/pulse-http';\nexport const send = createHttp;\n",
  "src/mapping/reads-http-subpath.ts":
    "import { attempt } from '@miragon/pulse-http/attempt';\nexport const tried = attempt;\n",
  "src/errors/escapes-into-http.ts":
    "import { createHttp } from '../../../../../core/http/src/http.ts';\nexport const send = createHttp;\n",
  "../../../core/http/src/http.ts": "export const createHttp = 1;\n",
  "test/engine-rest/sends.test.ts":
    "import { createHttp } from '@miragon/pulse-http';\nimport { recordingFetch } from '@miragon/pulse-http/testing';\nexport const both = [createHttp, recordingFetch];\n",
  "test/c7.engine.test.ts":
    "import { adapter } from '../src/index.ts';\nexport const unproven = adapter;\n",
  "test/engine-core.test.ts":
    "import { FakeEngine } from '@miragon/pulse-engine-core/testing';\nimport { pageQuery } from '@miragon/pulse-c7-core/testing';\nexport const fixtures = [FakeEngine, pageQuery];\n",
  "package.json": MANIFEST,
}

const UNPROVEN: Readonly<Record<string, string>> = {
  "src/index.ts": "export const adapter = 1;\n",
  "test/c7.engine.test.ts":
    "import { ConformanceKit } from '@miragon/pulse-engine-core/testing';\nexport const kit = ConformanceKit;\n",
  "package.json": MANIFEST,
}

const adapter = new PlantedTree(PACKAGE, ADAPTER)
const unproven = new PlantedTree(PACKAGE, UNPROVEN)

afterAll(() => {
  adapter.dispose()
  unproven.dispose()
})

describe("the dependency rules", () => {
  test("say where an import outside the closed world belongs", { timeout: 60_000 }, () => {
    expect(adapter.report()).toContain(
      `error not-in-allowed: ${PACKAGE}/src/mapping-uses-node.ts → child_process No entry of \`allowed\` in ${PACKAGE}/.dependency-cruiser.cjs permits this import.`,
    )
  })

  test("fire on every planted violation and on nothing else", { timeout: 60_000 }, () => {
    const at = (path: string): string => `${PACKAGE}/${path}`
    const view = at("node_modules/@miragon/pulse-runtime-view/dist/core/index.d.ts")
    const testing = at("node_modules/@miragon/pulse-engine-core/dist/testing/index.d.ts")
    const c7Testing = at("node_modules/@miragon/pulse-c7-core/dist/testing/index.d.ts")
    const c7Routes = at("node_modules/@miragon/pulse-c7-core/dist/routes.d.ts")
    const http = at("node_modules/@miragon/pulse-http/dist/index.d.ts")
    const loopback = at("node_modules/@miragon/pulse-http/dist/testing/loopback/index.d.ts")
    const httpSubpath = "@miragon/pulse-http/attempt"
    const httpSource = "packages/core/http/src/http.ts"
    expect(adapter.violations()).toEqual([
      `engine-test-runs-the-conformance-kit: ${at("test/c7.engine.test.ts")} -> ${at("test/c7.engine.test.ts")}`,
      `http-by-its-main-entry: ${at("src/engine-rest/http/escapes-into-http.ts")} -> ${httpSource}`,
      `http-by-its-main-entry: ${at("src/engine-rest/http/reads-an-unexported-file.ts")} -> ${httpSubpath}`,
      `http-by-its-main-entry: ${at("src/engine-rest/http/sends-a-test-engine.ts")} -> ${loopback}`,
      `http-only-in-the-wire: ${at("src/errors/escapes-into-http.ts")} -> ${httpSource}`,
      `http-only-in-the-wire: ${at("src/mapping/reads-http-subpath.ts")} -> ${httpSubpath}`,
      `http-only-in-the-wire: ${at("src/reading/sends-itself.ts")} -> ${http}`,
      `not-in-allowed: ${at("src/engine-rest/http/escapes-into-http.ts")} -> ${httpSource}`,
      `not-in-allowed: ${at("src/engine-rest/http/reads-an-unexported-file.ts")} -> ${httpSubpath}`,
      `not-in-allowed: ${at("src/engine-rest/http/sends-a-test-engine.ts")} -> ${loopback}`,
      `not-in-allowed: ${at("src/errors/escapes-into-http.ts")} -> ${httpSource}`,
      `not-in-allowed: ${at("src/mapping-uses-node.ts")} -> child_process`,
      `not-in-allowed: ${at("src/mapping/reads-http-subpath.ts")} -> ${httpSubpath}`,
      `not-in-allowed: ${at("src/reading/sends-itself.ts")} -> ${http}`,
      `not-in-allowed: ${at("src/reads-c7-routes.ts")} -> ${c7Routes}`,
      `not-in-allowed: ${at("src/reads-the-client.ts")} -> @miragon/pulse-c7-client`,
      `not-in-allowed: ${at("src/reads-the-core.ts")} -> ${view}`,
      `not-in-allowed: ${at("src/ships-c7-core-testing.ts")} -> ${c7Testing}`,
      `not-in-allowed: ${at("src/ships-engine-core-testing.ts")} -> ${testing}`,
      `not-to-unresolvable: ${at("src/engine-rest/http/reads-an-unexported-file.ts")} -> ${httpSubpath}`,
      `not-to-unresolvable: ${at("src/mapping/reads-http-subpath.ts")} -> ${httpSubpath}`,
      `not-to-unresolvable: ${at("src/reads-the-client.ts")} -> @miragon/pulse-c7-client`,
    ])
  })

  test("prove the adapter on an engine with the conformance kit", { timeout: 60_000 }, () => {
    expect(unproven.violations()).toEqual([
      `adapter-proven-on-an-engine: ${PACKAGE}/src/index.ts -> ${PACKAGE}/src/index.ts`,
    ])
  })
})
