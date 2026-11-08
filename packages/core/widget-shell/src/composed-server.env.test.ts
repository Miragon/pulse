import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComposableModule } from "./composition.js"
import { createComposedServer, type ComposedServerOptions } from "./composed-server.js"

/** The boot's own settings: the log level. */

const createPlugin = vi.fn(() => ({ name: "alpha", register: () => {} }))

const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin,
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  createPlugin.mockClear()
})

const options = (env: NodeJS.ProcessEnv): ComposedServerOptions => ({
  info: { name: "test-root", version: "0.0.0" },
  modules: [alpha],
  bundle: { jsPath: "/nonexistent/mcp-app.js" },
  env,
})

const warnings = () => vi.mocked(console.warn).mock.calls.map(([line]) => String(line))

describe("createComposedServer: the boot's own settings", () => {
  it("warns about an unknown or a debug log level", async () => {
    await createComposedServer(options({ MCP_LOG_LEVEL: "loud" }))
    await createComposedServer(options({ MCP_LOG_LEVEL: "debug" }))
    expect(warnings().filter((line) => line.includes("MCP_LOG_LEVEL"))).toEqual([
      "[test-root] MCP_LOG_LEVEL=loud is not a level (info, debug, trace): the request log stays at info.",
      expect.stringMatching(
        /^\[test-root\] MCP_LOG_LEVEL=debug: the request log shows tool arguments/,
      ),
    ])
  })
})
