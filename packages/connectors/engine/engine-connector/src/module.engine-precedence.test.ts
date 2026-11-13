import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { engineModule } from "./module.js"

describe("engineModule.configFromEnv engine precedence (ENGINES_FILE > ENGINES_JSON > BASE_URL > default)", () => {
  const FILE = { profiles: { "from-file": { url: "http://file.example/engine-rest" } } }
  const JSON_FILE = { profiles: { "from-json": { url: "http://json.example/engine-rest" } } }
  const FILE_ENGINES = [{ id: "from-file", baseUrl: "http://file.example/engine-rest" }]
  const JSON_ENGINES = [{ id: "from-json", baseUrl: "http://json.example/engine-rest" }]
  const enginesOf = (env: NodeJS.ProcessEnv) => engineModule.configFromEnv(env).engines
  let tmpDir: string | undefined

  function writeEnginesFile(content: unknown): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-engines-"))
    const file = path.join(tmpDir, "engines.json")
    fs.writeFileSync(file, JSON.stringify(content))
    return file
  }

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  })

  it("prefers ENGINES_FILE over ENGINES_JSON and BASE_URL", () => {
    expect(
      enginesOf({
        ENGINES_FILE: writeEnginesFile(FILE),
        ENGINES_JSON: JSON.stringify(JSON_FILE),
        ENGINE_BASE_URL: "http://engine.example/engine-rest",
      }),
    ).toEqual(FILE_ENGINES)
  })

  it("prefers ENGINES_JSON over BASE_URL when no file is set", () => {
    expect(
      enginesOf({
        ENGINES_JSON: JSON.stringify(JSON_FILE),
        ENGINE_BASE_URL: "http://engine.example/engine-rest",
      }),
    ).toEqual(JSON_ENGINES)
  })

  it("synthesizes one `default` engine from the ENGINE_BASE_URL shorthand, with its cockpit URL", () => {
    expect(
      enginesOf({
        ENGINE_BASE_URL: "http://engine.example/engine-rest",
        ENGINE_COCKPIT_URL: "http://engine.example/camunda",
      }),
    ).toEqual([
      {
        id: "default",
        baseUrl: "http://engine.example/engine-rest",
        cockpitUrl: "http://engine.example/camunda",
      },
    ])
    expect(enginesOf({ ENGINE_BASE_URL: "http://engine.example/engine-rest" })).toEqual([
      { id: "default", baseUrl: "http://engine.example/engine-rest" },
    ])
  })

  it("falls back to the local default engine when nothing is set", () => {
    expect(enginesOf({})).toEqual([{ id: "default", baseUrl: "http://localhost:8410/engine-rest" }])
  })

  it("treats whitespace-only values as unset when resolving precedence", () => {
    expect(enginesOf({ ENGINES_FILE: "   ", ENGINES_JSON: JSON.stringify(JSON_FILE) })).toEqual(
      JSON_ENGINES,
    )
  })

  it("reads environment from each profile in both sources, in the order of the file", () => {
    const grouped = {
      profiles: {
        "eu-a": { url: "http://eu-a.example/engine-rest", environment: "prod-eu" },
        "us-a": { url: "http://us-a.example/engine-rest", environment: "prod-us" },
      },
    }
    const engines = [
      { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a.example/engine-rest", environment: "prod-us" },
    ]
    expect(enginesOf({ ENGINES_JSON: JSON.stringify(grouped) })).toEqual(engines)
    expect(enginesOf({ ENGINES_FILE: writeEnginesFile(grouped) })).toEqual(engines)
  })
})
