import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")
const boot = () => createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/**
 * A setting the boot cannot use fails it with a sentence that names the variable, BEFORE the log
 * states the toolsets and the HTTP edge: lines that read like a healthy boot never precede it.
 * `src/index.ts` prints the sentence as one line through `runComposedServer`.
 */
describe("the boot refuses a setting it cannot use, before it logs the toolsets", () => {
  it.each([
    [
      "an engine entry that breaks the schema",
      { ENGINES_JSON: '[{"id":"Prod_A","baseUrl":"http://localhost:8410/engine-rest"}]' },
      "ENGINES_JSON[0].id: Engine id must be lowercase alphanumeric / dashes, starting with a letter or digit",
    ],
    [
      "an engine URL without a scheme",
      { ENGINE_BASE_URL: "localhost:8410/engine-rest" },
      "ENGINE_BASE_URL: Expected an http:// or https:// URL of the REST API root, e.g. http://localhost:8410/engine-rest",
    ],
    [
      "a Prometheus URL without a scheme",
      { PROMETHEUS_URL: "localhost:8460" },
      "PROMETHEUS_URL must be an http:// or https:// URL, e.g. http://localhost:9090",
    ],
    [
      "an unknown module",
      { MCP_ACTIVE_MODULES: "engines:operations,analytic" },
      '[pulse] MCP_ACTIVE_MODULES names the unknown modules "engines", "analytic", so the server does not start without the modules it asks for. Known modules: engine, analytics.',
    ],
  ])("%s", async (_case, env, message) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv(env)
    await expect(boot()).rejects.toThrow(message)
    expect(info).not.toHaveBeenCalled()
  })

  /** `bootWarnings` names the ids of a passthrough engine: only a checked config reaches it. */
  it("logs no secret of an engine setting in front of its error", async () => {
    const SECRET = "pl4nted-S3cret"
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv({
      ENGINES_JSON: JSON.stringify([
        {
          id: SECRET,
          baseUrl: `https://svc:${SECRET}@engine.example/engine-rest`,
          auth: { type: "passthrough" },
        },
      ]),
      ENGINE_DEFAULT: `${SECRET}-other`,
    })
    const refused = (await boot().catch((error: unknown) => error)) as Error
    expect(refused.message).toContain("ENGINES_JSON[0].baseUrl: Must not contain credentials")
    expect(refused.message).not.toContain(SECRET)
    expect(JSON.stringify([info.mock.calls, warn.mock.calls])).not.toContain(SECRET)
  })
})

/** `src/index.ts` itself, imported as `node dist/index.js` runs it: a revert to its own listen fails here. */
describe("the entry prints a refused setting as one line and exits 1", () => {
  it("names the server and the setting, logs nothing before it and shows no stack", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const written: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array, ...rest: unknown[]) => {
        written.push(String(chunk))
        const done = rest.find((arg) => typeof arg === "function") as (() => void) | undefined
        done?.()
        return true
      },
    )
    // A real exit would end the test run: the stand-in rejects the entry's import instead.
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`)
    })
    stubNeutralEnv({ MCP_ACTIVE_MODULES: "engines" })
    await expect(import("../src/index.js")).rejects.toThrow("process.exit(1)")
    expect(written).toEqual([
      '[pulse] The server did not start: MCP_ACTIVE_MODULES names an unknown module "engines", so the server does not start without the module it asks for. Known modules: engine, analytics.\n',
    ])
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
