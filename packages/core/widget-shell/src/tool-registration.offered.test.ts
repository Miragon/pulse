import { describe, expect, it } from "vitest"
import type { ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"
import { createModuleRegistry } from "./tool-registration.js"

/** `B` as a minifier names it: the sentence V8 writes carries the name of the object. */
type Loose = Record<string, () => unknown>

const callingOn = (call: (B: Loose) => unknown): ModulePlugin => ({
  name: "crm",
  register: (server) => void call(server as unknown as Loose),
})

const throwing = (error: Error): ModulePlugin => ({
  name: "crm",
  register: () => {
    throw error
  },
})

const failureOf = (plugin: ModulePlugin): Error => {
  try {
    createModuleRegistry(undefined, "test-root").register(plugin)
  } catch (error) {
    return error as Error
  }
  throw new Error(`${plugin.name} registered without an error`)
}

const answer = () => ({ content: [{ type: "text" as const, text: "ok" }] })
const OFFERED = "registerTool, registerPrompt and registerResource."

describe("createModuleRegistry: a call the ModuleServer does not offer", () => {
  it("names the module and the method, and keeps V8's TypeError as the cause", () => {
    const error = failureOf(callingOn((B) => B.tool()))
    expect(error).toBeInstanceOf(TypeError)
    expect(error.message).toBe(
      `Module "crm" failed in register(server): B.tool is not a function. Its server, a ModuleServer, has no tool(): it offers ${OFFERED}`,
    )
    expect(error.cause).toBeInstanceOf(TypeError)
    expect((error.cause as Error).message).toBe("B.tool is not a function")
    expect(error.stack?.startsWith(`TypeError: ${error.message}\n`)).toBe(true)
  })

  it.each<[string, (B: Loose) => unknown, string, string]>([
    [
      "a method of the SDK's McpServer",
      (B) => B.connect(),
      "B.connect is not a function",
      "connect",
    ],
    [
      "a former method called off the server",
      (B) => {
        const { prompt } = B
        return prompt()
      },
      "prompt is not a function",
      "prompt",
    ],
  ])("names %s the server does not carry", (_, call, sentence, method) => {
    expect(failureOf(callingOn(call)).message).toBe(
      `Module "crm" failed in register(server): ${sentence}. Its server, a ModuleServer, has no ${method}(): it offers ${OFFERED}`,
    )
  })

  const config = { engines: {} as Loose }
  it.each<[string, (B: Loose) => unknown, string]>([
    ["a method no server has", () => config.engines.map(), "config.engines.map is not a function"],
    ["a computed method", (B) => B[String("tool")](), "B[String(...)] is not a function"],
  ])("names only the module on %s, which need not be the server's", (_, call, sentence) => {
    expect(failureOf(callingOn(call)).message).toBe(
      `Module "crm" failed in register(server): ${sentence}.`,
    )
  })

  it("never claims the server lacks a method it offers, when another object lacks it", () => {
    const other = {} as Loose
    expect(failureOf(callingOn(() => other.registerTool())).message).toBe(
      `Module "crm" failed in register(server): other.registerTool is not a function. Its server, a ModuleServer, offers ${OFFERED}`,
    )
  })

  it("still refuses a registration once the failed register returned", () => {
    const registry = createModuleRegistry(undefined, "test-root")
    let kept: ModuleServer | undefined
    const plugin = callingOn((B) => {
      kept = B as unknown as ModuleServer
      return B.tool()
    })
    expect(() => registry.register(plugin)).toThrow('Module "crm" failed')
    expect(() => kept?.registerTool("crm_list", {}, answer)).toThrow(
      'Tool "crm_list" registers after "crm" returned from register(server)',
    )
  })

  it.each<[string, Error]>([
    ["a module's own error", new Error("boom")],
    ["another TypeError", new TypeError("Cannot read properties of undefined (reading 'x')")],
    ["the sentence in another error", new Error("B.tool is not a function")],
    ["the sentence inside a longer one", new TypeError("B.tool is not a function, says the lib")],
  ])("hands %s on as it is", (_, planted) => {
    expect(failureOf(throwing(planted))).toBe(planted)
  })

  it("leaves the registry's own refusals as they are", () => {
    const noCallback = failureOf({
      name: "crm",
      register: (server) => {
        ;(server.registerTool as unknown as (...args: unknown[]) => unknown)("x_none", {})
      },
    })
    expect(noCallback.message).toBe('Tool "x_none" of "crm" has no callback.')
    expect(noCallback.cause).toBeUndefined()

    const registry = createModuleRegistry(undefined, "test-root")
    const listing = (name: string): ModulePlugin => ({
      name,
      register: (server) => void server.registerTool("x_list", {}, answer),
    })
    registry.register(listing("alpha"))
    expect(() => registry.register(listing("beta"))).toThrow(
      'Tool "x_list" is registered twice: by "alpha" and again by "beta". A server lists one tool per name, so rename one of them.',
    )
  })
})
