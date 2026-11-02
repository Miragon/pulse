import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { camunda7Module } from "./module.js"

describe("camunda7Module.configFromEnv engine precedence (ENGINES_FILE > ENGINES_JSON > BASE_URL > default)", () => {
  const FILE_ENGINES = [{ id: "from-file", baseUrl: "http://file.example/engine-rest" }]
  const JSON_ENGINES = [{ id: "from-json", baseUrl: "http://json.example/engine-rest" }]
  const enginesOf = (env: NodeJS.ProcessEnv) => camunda7Module.configFromEnv(env).engines
  let tmpDir: string | undefined

  function writeEnginesFile(engines: unknown): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "camunda7-engines-"))
    const file = path.join(tmpDir, "engines.json")
    fs.writeFileSync(file, JSON.stringify(engines))
    return file
  }

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  })

  it("prefers CAMUNDA_ENGINES_FILE over ENGINES_JSON and BASE_URL", () => {
    expect(
      enginesOf({
        CAMUNDA_ENGINES_FILE: writeEnginesFile(FILE_ENGINES),
        CAMUNDA_ENGINES_JSON: JSON.stringify(JSON_ENGINES),
        CAMUNDA_BASE_URL: "http://engine.example/engine-rest",
      }),
    ).toEqual(FILE_ENGINES)
  })

  it("prefers CAMUNDA_ENGINES_JSON over BASE_URL when no file is set", () => {
    expect(
      enginesOf({
        CAMUNDA_ENGINES_JSON: JSON.stringify(JSON_ENGINES),
        CAMUNDA_BASE_URL: "http://engine.example/engine-rest",
      }),
    ).toEqual(JSON_ENGINES)
  })

  it("synthesizes one `default` engine from the CAMUNDA_BASE_URL shorthand, with its cockpit URL", () => {
    expect(
      enginesOf({
        CAMUNDA_BASE_URL: "http://engine.example/engine-rest",
        CAMUNDA_COCKPIT_URL: "http://engine.example/camunda",
      }),
    ).toEqual([
      {
        id: "default",
        baseUrl: "http://engine.example/engine-rest",
        cockpitUrl: "http://engine.example/camunda",
      },
    ])
    expect(enginesOf({ CAMUNDA_BASE_URL: "http://engine.example/engine-rest" })).toEqual([
      { id: "default", baseUrl: "http://engine.example/engine-rest" },
    ])
  })

  it("falls back to the local default engine when nothing is set", () => {
    expect(enginesOf({})).toEqual([{ id: "default", baseUrl: "http://localhost:8410/engine-rest" }])
  })

  it("treats whitespace-only values as unset when resolving precedence", () => {
    expect(
      enginesOf({
        CAMUNDA_ENGINES_FILE: "   ",
        CAMUNDA_ENGINES_JSON: JSON.stringify(JSON_ENGINES),
      }),
    ).toEqual(JSON_ENGINES)
  })

  it("accepts the environment-map form in both JSON sources, stamping each key as environment", () => {
    const asMap = {
      "prod-eu": [{ id: "eu-a", baseUrl: "http://eu-a.example/engine-rest" }],
      "prod-us": [{ id: "us-a", baseUrl: "http://us-a.example/engine-rest" }],
    }
    const flattened = [
      { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a.example/engine-rest", environment: "prod-us" },
    ]
    expect(enginesOf({ CAMUNDA_ENGINES_JSON: JSON.stringify(asMap) })).toEqual(flattened)
    expect(enginesOf({ CAMUNDA_ENGINES_FILE: writeEnginesFile(asMap) })).toEqual(flattened)
  })
})
