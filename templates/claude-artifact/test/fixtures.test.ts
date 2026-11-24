import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { type Fixture, mockClaude } from "../fixtures/mock-claude.ts"
import { DASHBOARD_READS } from "../src/data/process-dashboard.ts"
import { claudeConnector, CONNECTOR_NAME } from "../src/engine/claude-connector.ts"
import { callKey, createEngine } from "../src/engine/engine.ts"
import { PAGE_TOOLS } from "../src/engine/tools.ts"
import { pageProcessKey, processKeyOf } from "../scripts/process-key.ts"
import { clearTextTokenRefusal, isLoopbackHost } from "../scripts/token-target.ts"
import { PROCESS_KEY } from "../src/app.tsx"

const DIR = new URL("../fixtures/", import.meta.url)
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".json"))
const read = (name: string) => readFileSync(new URL(name, DIR), "utf8")

describe("the recorded fixtures", () => {
  it("the scripts read the page's process key from src/app.tsx", () => {
    expect(pageProcessKey()).toBe(PROCESS_KEY)
    expect(() => processKeyOf("const key = 1")).toThrow(/--process/)
  })

  it("hold the dashboard's process", () => {
    expect(FILES).toContain(`${PROCESS_KEY}.json`)
  })

  it.each(FILES)(
    "%s: written as JSON.stringify(x, null, 2), one call per tool and arguments",
    (name) => {
      const text = read(name)
      const fixture = JSON.parse(text) as Fixture
      expect(text).toBe(`${JSON.stringify(fixture, null, 2)}\n`)
      expect(name).toBe(`${fixture.process}.json`)
      const keys = fixture.calls.map((call) => callKey(call.tool, call.arguments))
      expect(new Set(keys).size).toBe(keys.length)
      for (const call of fixture.calls) expect(PAGE_TOOLS).toContain(call.tool)
    },
  )

  it.each(FILES)(
    "%s: answers every call the dashboard's reads make, through the page's connector",
    async (name) => {
      const fixture = JSON.parse(read(name)) as Fixture
      const asOf = new Date(fixture.asOf)
      const engine = createEngine(claudeConnector(mockClaude(fixture)), { now: () => asOf })
      for (const [section, read] of Object.entries(DASHBOARD_READS)) {
        await expect(read(engine, fixture.process), section).resolves.toBeDefined()
      }
    },
  )

  it("refuses a call it never recorded with an error that names it, as the server's error", async () => {
    const connector = claudeConnector(mockClaude(pageFixture()))
    const call = connector.callTool("engine_status", { processDefinitionKeyIn: ["nothing"] })
    await expect(call).rejects.toMatchObject({
      code: "tool_error",
      detail: expect.stringContaining("No recorded answer for engine_status") as unknown,
    })
  })

  it("refuses a connector of another name as the runtime does", async () => {
    const connector = claudeConnector(mockClaude(pageFixture()), "Other")
    await expect(connector.callTool("engine_list_engines", {})).rejects.toMatchObject({
      code: "not_connected",
      detail: expect.stringContaining("[server_not_connected]") as unknown,
    })
  })

  it("refuses a tool outside PAGE_TOOLS as the runtime refuses one the page does not declare", async () => {
    const mcp = await mockClaude(pageFixture()).use?.("mcp")
    await expect(mcp?.callTool(CONNECTOR_NAME, "engine_open_cockpit", {})).rejects.toMatchObject({
      code: "not_in_manifest",
    })
  })

  it("fails a tool with an engine error, every call with a runtime code, a tool with a code", async () => {
    const fixture = pageFixture()
    const listEngines = (fail: string[]) =>
      claudeConnector(mockClaude(fixture, { fail })).callTool("engine_list_engines", {})
    await expect(listEngines(["engine_list_engines"])).rejects.toMatchObject({
      code: "tool_error",
      detail: expect.stringContaining("[503 ServiceUnavailable]") as unknown,
    })
    await expect(listEngines(["needs_reauth"])).rejects.toMatchObject({ code: "needs_reauth" })
    await expect(listEngines(["engine_list_engines:server_unavailable"])).rejects.toMatchObject({
      code: "unavailable",
    })
    await expect(listEngines(["engine_status:approval_required"])).resolves.toMatchObject({
      structuredContent: { engines: expect.any(Array) as unknown },
    })
  })
})

/** The recording of the page's own process. */
function pageFixture(): Fixture {
  return JSON.parse(read(`${PROCESS_KEY}.json`)) as Fixture
}

describe("the recorder's token", () => {
  const TOKEN = "eyJhbGciOiJSUzI1NiJ9.secret"
  const refusal = (url: string, token: string | undefined) =>
    clearTextTokenRefusal(new URL(url), token)

  it("refuses to send MCP_TOKEN over plain http beyond loopback, naming the host, never the token", () => {
    const text = refusal("http://pulse.internal:8400/mcp", TOKEN)
    expect(text).toContain("pulse.internal:8400")
    expect(text).not.toContain(TOKEN)
    expect(refusal("http://10.0.0.7/mcp", TOKEN)).toContain("10.0.0.7")
    expect(refusal("http://localhost.example.com/mcp", TOKEN)).not.toBeNull()
  })

  it("sends it over https, to a loopback host, and sends nothing without one", () => {
    expect(refusal("https://pulse.example.com/mcp", TOKEN)).toBeNull()
    for (const url of [
      "http://localhost:8400/mcp",
      "http://LOCALHOST:8400/mcp",
      "http://127.0.0.1:8400/mcp",
      "http://127.8.9.10/mcp",
      "http://[::1]:8400/mcp",
    ]) {
      expect(refusal(url, TOKEN), url).toBeNull()
    }
    expect(refusal("http://pulse.internal/mcp", undefined)).toBeNull()
    expect(refusal("http://pulse.internal/mcp", "")).toBeNull()
  })

  it("counts localhost, [::1] and 127.0.0.0/8 as loopback, nothing else", () => {
    expect(["localhost", "[::1]", "127.0.0.1", "127.255.0.1"].every(isLoopbackHost)).toBe(true)
    expect(
      ["0.0.0.0", "128.0.0.1", "127.0.0.1.example.com", "::1", "local"].some(isLoopbackHost),
    ).toBe(false)
  })
})
