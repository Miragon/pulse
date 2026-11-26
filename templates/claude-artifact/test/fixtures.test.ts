import { readdirSync, readFileSync } from "node:fs"
import { createPageReader, playRecording } from "@miragon/pulse-widget-shell/widgets"
import { describe, expect, it } from "vitest"
import type { Fixture } from "../fixtures/fixture.ts"
import { clearTextTokenRefusal, isLoopbackHost } from "../scripts/token-target.ts"
import { DASHBOARD_READS } from "../src/data/process-dashboard.ts"
import { PAGE_TOOLS, PROCESS_KEY } from "../src/page.config.ts"

const DIR = new URL("../fixtures/", import.meta.url)
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".json"))
const fixtureOf = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as Fixture

describe("the recorded fixtures", () => {
  it("hold the dashboard's process", () => {
    expect(FILES).toContain(`${PROCESS_KEY}.json`)
  })

  it.each(FILES)(
    "%s: answers every call the dashboard's reads make, through the page's reader",
    async (name) => {
      const fixture = fixtureOf(name)
      expect(name).toBe(`${fixture.process}.json`)
      const { callTool, now, timeZone } = playRecording(fixture, { tools: PAGE_TOOLS })
      const reader = createPageReader(callTool, { now, timeZone })
      for (const [section, read] of Object.entries(DASHBOARD_READS)) {
        await expect(read(reader, fixture.process), section).resolves.toBeDefined()
      }
    },
  )

  it("refuses a tool outside PAGE_TOOLS as the runtime refuses one the page does not declare", async () => {
    const { callTool } = playRecording(fixtureOf(`${PROCESS_KEY}.json`), { tools: PAGE_TOOLS })
    await expect(callTool("engine_open_cockpit", {})).rejects.toMatchObject({
      code: "not_allowed",
      tool: "engine_open_cockpit",
    })
  })
})

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
