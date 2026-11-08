import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { ComposableModule } from "./composition.js"
import {
  createComposedServer,
  type ComposedServer,
  type ComposedServerOptions,
  type ListenOptions,
  type RunningServer,
} from "./composed-server.js"
import { runComposedServer } from "./run-composed-server.js"

const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: (env) => ({ url: env.ALPHA_URL ?? "http://alpha.example" }),
  knownEnvVars: ["ALPHA_URL"],
  createPlugin: () => ({ name: "alpha", register: () => {} }),
}

const running: RunningServer[] = []
let written: string[]
let exit: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  written = []
  vi.spyOn(process.stderr, "write").mockImplementation(
    (chunk: string | Uint8Array, ...rest: unknown[]) => {
      written.push(String(chunk))
      const done = rest.find((arg) => typeof arg === "function") as (() => void) | undefined
      done?.()
      return true
    },
  )
  // A real exit would end the test run: the stand-in ends the run's promise instead.
  exit = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${String(code)})`)
  })
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function options(overrides: Partial<ComposedServerOptions> = {}): ComposedServerOptions {
  return {
    info: { name: "test-root", version: "1.2.3" },
    modules: [alpha],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  }
}

/** `createApp` as a root writes it; `listen` records its options and never installs signal handlers. */
function createApp(overrides: Partial<ComposedServerOptions> = {}) {
  const listened: ListenOptions[] = []
  const create = async (): Promise<ComposedServer> => {
    const composed = await createComposedServer(options(overrides))
    return {
      ...composed,
      listen: async (listenOptions = {}) => {
        listened.push(listenOptions)
        const server = await composed.listen({ ...listenOptions, handleSignals: false })
        running.push(server)
        return server
      },
    }
  }
  return { create, listened }
}

const failing = (configFromEnv: ComposableModule<object>["configFromEnv"]) =>
  createApp({ modules: [{ ...alpha, configFromEnv }] }).create

describe("runComposedServer", () => {
  it("prints a failed boot as ONE line under the server's name, without a stack, and exits 1", async () => {
    const create = failing(() => {
      throw new Error("ALPHA_URL must be an http:// or https:// URL")
    })
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    expect(written).toEqual([
      "[test-root] The server did not start: ALPHA_URL must be an http:// or https:// URL\n",
    ])
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it("names the server once when the error already opens with it", async () => {
    const { create } = createApp({ env: { MCP_ACTIVE_MODULES: "nope" } })
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    expect(written).toEqual([
      '[test-root] The server did not start: MCP_ACTIVE_MODULES names an unknown module "nope", so the server does not start without the module it asks for. Known modules: alpha.\n',
    ])
  })

  it("prints a ZodError's issues as `path: message`, not as JSON", async () => {
    const schema = z.object({
      engines: z.array(z.object({ id: z.string() })),
      port: z.number(),
    })
    const create = failing(() => schema.parse({ engines: [{}], port: "x" }))
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    expect(written).toEqual([
      "[test-root] The server did not start: engines[0].id: Invalid input: expected string, received undefined; port: Invalid input: expected number, received string\n",
    ])
  })

  it("joins a message over several lines into one", async () => {
    const create = failing(() => {
      throw new Error("first line\n  second line")
    })
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    expect(written).toEqual(["[test-root] The server did not start: first line second line\n"])
  })

  it("keeps the frames of a bug below the line, so a reader finds where it happened", async () => {
    const create = failing(() => {
      const config = undefined as unknown as { url: string }
      return { url: config.url }
    })
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    const [line, ...frames] = written.join("").trimEnd().split("\n")
    expect(line).toMatch(
      /^\[test-root\] The server did not start: Cannot read properties of undefined/,
    )
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((frame) => /^\s+at /.test(frame))).toBe(true)
    expect(frames[0]).toContain("run-composed-server.test.ts")
  })

  it("names the module on a server method it does not get, with the frames of that call", async () => {
    const usesOldApi: ComposableModule<object> = {
      ...alpha,
      createPlugin: () => ({
        name: "alpha",
        register: (server) => void (server as unknown as { tool: () => void }).tool(),
      }),
    }
    const { create } = createApp({ modules: [usesOldApi] })
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    const [line, ...frames] = written.join("").trimEnd().split("\n")
    expect(line).toBe(
      '[test-root] The server did not start: Module "alpha" failed in register(server): server.tool is not a function. Its server, a ModuleServer, has no tool(): it offers registerTool, registerPrompt and registerResource.',
    )
    expect(frames[0]).toContain("run-composed-server.test.ts")
  })

  it.each([
    ["a SyntaxError of a refused setting", new SyntaxError("Unexpected token 'x'")],
    [
      "an Error subclass of a module",
      new (class ConfigError extends Error {})("ALPHA_URL is wrong"),
    ],
  ])("prints %s without frames", async (_, error) => {
    const create = failing(() => {
      throw error
    })
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    expect(written).toEqual([`[test-root] The server did not start: ${error.message}\n`])
  })

  it("prints an error thrown before the boot without a name", async () => {
    const create = () => Promise.reject(new Error("package.json is missing"))
    await expect(runComposedServer(create)).rejects.toThrow("process.exit(1)")
    expect(written).toEqual(["The server did not start: package.json is missing\n"])
  })

  it("names the server on a failed listen (a taken port)", async () => {
    const taken = http.createServer()
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve))
    try {
      const { port } = taken.address() as AddressInfo
      const { create } = createApp()
      await expect(
        runComposedServer(create, { listen: { port, host: "127.0.0.1" } }),
      ).rejects.toThrow("process.exit(1)")
      expect(written).toEqual([
        expect.stringMatching(/^\[test-root\] The server did not start: listen EADDRINUSE: .*\n$/),
      ])
    } finally {
      await new Promise((resolve) => taken.close(resolve))
    }
  })

  it("listens with the drain on signals and returns the app", async () => {
    const { create, listened } = createApp()
    const app = await runComposedServer(create, { listen: { port: 0, host: "127.0.0.1" } })
    expect(typeof app.fetch).toBe("function")
    expect(listened).toEqual([{ handleSignals: true, port: 0, host: "127.0.0.1" }])
    expect(written).toEqual([])
    expect(exit).not.toHaveBeenCalled()
  })
})
