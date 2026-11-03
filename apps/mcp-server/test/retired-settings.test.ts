import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { engineModule } from "@miragon/pulse-engine-connector"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")
const boot = () => createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/**
 * An upgrade with the settings of 0.24 never boots without the engine module or with a
 * setting silently ignored: the boot refuses each retired name and names its replacement. The
 * names come from the module's own table, so this test writes none of them out.
 */
describe("the boot refuses the retired camunda7 settings, or warns on a credential", () => {
  const { names, envVars, warnedEnvVars } = engineModule.retired

  it.each(Object.entries(envVars))("refuses %s, naming %s", async (retired, replacement) => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    // The neutral env clears the retired names a shell may export; this sets one on purpose.
    stubNeutralEnv({ [retired]: "http://localhost:1" })
    await expect(boot()).rejects.toThrow(
      `[pulse] ${retired} is no longer read, so the server does not start with a setting it would ignore. ` +
        `Rename it, the value stays: ${retired} becomes ${replacement}.`,
    )
  })

  // A shell may export a credential under the old name for pulse-cli; a missing replacement fails
  // the auth check anyway.
  it.each(Object.entries(warnedEnvVars))(
    "boots with %s set and warns that it reads %s",
    async (retired, replacement) => {
      vi.spyOn(console, "info").mockImplementation(() => {})
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      stubNeutralEnv({ [retired]: "secret" })
      await expect(boot()).resolves.toBeDefined()
      expect(warn).toHaveBeenCalledWith(
        `[pulse] ${retired} is no longer read; the server reads ${replacement}. Rename it if it was meant for the server.`,
      )
    },
  )

  it("refuses the former module name, carrying its toolset over", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const [former] = names
    stubNeutralEnv({ MCP_ACTIVE_MODULES: `${former}:operations,analytics` })
    await expect(boot()).rejects.toThrow(
      `[pulse] MCP_ACTIVE_MODULES names "${former}", the former name of the engine module, so the server does not start without the module it asks for. ` +
        `Write engine instead: ${former}:operations becomes engine:operations.`,
    )
  })

  it("boots on the current names", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv({ MCP_ACTIVE_MODULES: "engine:operations,analytics" })
    const composed = await boot()
    expect(composed.boot.toolsets[0]).toMatchObject({ module: "engine", toolset: "operations" })
  })
})
