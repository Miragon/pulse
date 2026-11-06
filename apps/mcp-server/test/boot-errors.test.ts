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
})
