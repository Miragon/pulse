import { afterEach, describe, expect, it, vi } from "vitest"
import { MODULES } from "../src/setup.js"
import { stubNeutralEnv } from "./neutral-env.js"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/**
 * `src/index.ts` itself, imported as `node dist/index.js` runs it: the entry boots through
 * `runComposedServer`, so a setting the boot refuses prints as ONE line under the server's name,
 * without a stack, and the process exits 1. An entry that listens on its own fails here.
 */
describe("the entry prints a refused setting as one line and exits 1", () => {
  it("names the server and the setting, without a stack", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
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
    stubNeutralEnv({ MCP_ACTIVE_MODULES: "no-such-module", MCP_USE_DEV_CLI: undefined })

    await expect(import("../src/index.js")).rejects.toThrow("process.exit(1)")

    // `[<your server's name>] …`, one line, the modules this server composes listed.
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(
      /^\[[^\]\n]+\] The server did not start: MCP_ACTIVE_MODULES names an unknown module "no-such-module", [^\n]+\.\n$/,
    )
    expect(written[0]).toContain(`Known modules: ${MODULES.map(({ name }) => name).join(", ")}.`)
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })
})
