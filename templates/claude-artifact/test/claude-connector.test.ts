import { describe, expect, it } from "vitest"
import {
  claudeConnector,
  RUNTIME_CODES,
  type ClaudeRuntime,
  type McpAnswer,
  type McpCapability,
} from "../src/engine/claude-connector.ts"
import type { EngineErrorCode } from "../src/engine/connector.ts"
import { ANSWER_TTL_MS, createEngine } from "../src/engine/engine.ts"
import { describeEngineError } from "../src/engine/errors.ts"
import { CONNECTOR_NAME } from "../src/page.config.ts"

/** A runtime whose capability answers `answer`, recording each call and each `use("mcp")`. */
function runtimeOf(answer: (...args: Parameters<McpCapability["callTool"]>) => Promise<McpAnswer>) {
  const calls: Parameters<McpCapability["callTool"]>[] = []
  let uses = 0
  const runtime: ClaudeRuntime = {
    use: () => {
      uses += 1
      return Promise.resolve({
        callTool: (...args) => {
          calls.push(args)
          return answer(...args)
        },
      })
    },
  }
  return { runtime, calls, uses: () => uses }
}

/** A rejection as the runtime gives one: a plain object, never an `Error`. */
const refusal = (code: string | undefined, message: string) =>
  Promise.reject({ ...(code === undefined ? {} : { code }), message, server: CONNECTOR_NAME })

describe("the artifact's connector (claude-connector.ts)", () => {
  it("calls the tool positionally on the connector the page names and reads the payload", async () => {
    const { runtime, calls } = runtimeOf(() => Promise.resolve({ payload: { items: [] } }))
    const result = await claudeConnector(runtime).callTool("engine_process_stats", {
      processDefinitionKey: "p",
    })
    expect(result).toEqual({ structuredContent: { items: [] } })
    expect(calls).toEqual([
      [
        CONNECTOR_NAME,
        "engine_process_stats",
        { processDefinitionKey: "p" },
        { cache: { staleTime: ANSWER_TTL_MS, gcTime: 600_000 } },
      ],
    ])
  })

  it("asks the runtime past its cache for a refresh", async () => {
    const { runtime, calls } = runtimeOf(() => Promise.resolve({ payload: {} }))
    const connector = claudeConnector(runtime)
    await connector.callTool("engine_process_stats", {}, { refresh: true })
    await connector.callTool("engine_process_stats", {}, { refresh: false })
    expect(calls.map((call) => call[3])).toEqual([
      { cache: { staleTime: 0, gcTime: 600_000, refresh: true } },
      { cache: { staleTime: ANSWER_TTL_MS, gcTime: 600_000 } },
    ])
  })

  it.each([...RUNTIME_CODES])(
    "reads the runtime's %s as the page's %s, the code under Details",
    async (code, pageCode) => {
      const { runtime } = runtimeOf(() => refusal(code, "refused"))
      await expect(
        claudeConnector(runtime).callTool("engine_process_stats", {}),
      ).rejects.toMatchObject({
        code: pageCode,
        tool: "engine_process_stats",
        detail: `[${code}] refused`,
      })
    },
  )

  it("maps the seven codes the runtime is known to give", () => {
    expect(Object.fromEntries(RUNTIME_CODES)).toEqual({
      needs_reauth: "needs_reauth",
      server_not_connected: "not_connected",
      selection_required: "not_connected",
      not_in_manifest: "not_allowed",
      blocked_by_policy: "not_allowed",
      approval_required: "approval_required",
      server_unavailable: "unavailable",
    } satisfies Record<string, EngineErrorCode>)
  })

  it.each([
    ["another code", "tool_failed"],
    ["a name of Object's prototype", "toString"],
    ["no code", undefined],
  ])("reads a rejection with %s as the server's error, its message alone", async (_, code) => {
    const text = "engine prod-a unreachable (ECONNREFUSED)"
    const { runtime } = runtimeOf(() => refusal(code, text))
    const error = await claudeConnector(runtime)
      .callTool("engine_process_stats", {})
      .catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ code: "tool_error", detail: text })
    // The kit classifies the engine's text, so the words name the engine, not the raw text.
    const words = describeEngineError(error as never, "en")
    expect(words.title).toContain("prod-a")
    expect(words.details).toBe(text)
  })

  it.each([
    ["a runtime code", { code: "needs_reauth" }, "needs_reauth", "[needs_reauth]"],
    ["another code", { code: "tool_failed" }, "tool_error", "tool_failed"],
    ["no code", {}, "tool_error", ""],
  ])(
    "reads a rejection without a message (%s) by its code alone",
    async (_, thrown, code, detail) => {
      const { runtime } = runtimeOf(() => Promise.reject(thrown))
      await expect(
        claudeConnector(runtime).callTool("engine_process_stats", {}),
      ).rejects.toMatchObject({
        code,
        detail,
      })
    },
  )

  it("reads the runtime's answer and a tool's error as the probe of 2026-11-25 saw them", async () => {
    const data = { activities: [{ activityId: "a" }] }
    const text = 'Invalid arguments for tool engine_activity_counts: Unknown key "n".'
    const answers: Record<string, () => Promise<McpAnswer>> = {
      // A result with `payload`, the tool's JSON, next to its `structuredContent`.
      1: () =>
        Promise.resolve({
          _meta: { mimeType: "application/json" },
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
          payload: data,
        } as McpAnswer),
      // A tool that answers text only.
      2: () => Promise.resolve({ payload: '{"activities":[]}' }),
      // A tool's error (here strict input) rejects as `tool_error` with the tool's result.
      3: () =>
        Promise.reject({
          code: "tool_error",
          server: CONNECTOR_NAME,
          message: text,
          result: { content: [{ type: "text", text }], isError: true },
        }),
    }
    const { runtime } = runtimeOf((_, _tool, args) => answers[String(args.n)]())
    const engine = createEngine(claudeConnector(runtime))
    const call = (n: number) => engine.call("engine_activity_counts", { n })
    await expect(call(1)).resolves.toEqual(data)
    await expect(call(2)).resolves.toEqual({ activities: [] })
    await expect(call(3)).rejects.toMatchObject({ code: "tool_error", detail: text })
  })

  it.each([
    ["no window.claude", undefined],
    ["no use", {}],
    ["no capability (null)", { use: () => Promise.resolve(null) }],
    ["no capability (undefined)", { use: () => Promise.resolve(undefined) }],
    ["a use that rejects", { use: () => Promise.reject(new Error("no mcp here")) }],
  ] as [string, ClaudeRuntime | undefined][])(
    "reads %s as a page without a connector",
    async (_, runtime) => {
      await expect(
        claudeConnector(runtime).callTool("engine_process_stats", {}),
      ).rejects.toMatchObject({
        code: "not_connected",
        tool: "engine_process_stats",
      })
    },
  )

  it("asks the runtime anew after a refusal, never after the server's error", async () => {
    let next: () => Promise<McpAnswer> = () => refusal("selection_required", "pick one")
    const { runtime, uses } = runtimeOf(() => next())
    const connector = claudeConnector(runtime)
    await expect(connector.callTool("engine_process_stats", {})).rejects.toMatchObject({
      code: "not_connected",
    })
    next = () => refusal(undefined, "[503] down")
    await expect(connector.callTool("engine_process_stats", {})).rejects.toMatchObject({
      code: "tool_error",
    })
    next = () => Promise.resolve({ payload: { ok: true } })
    await expect(connector.callTool("engine_process_stats", {})).resolves.toEqual({
      structuredContent: { ok: true },
    })
    expect(uses()).toBe(2)
  })
})
