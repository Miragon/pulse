import { afterEach, describe, expect, it, vi } from "vitest"
import type { PageErrorCode } from "@miragon/pulse-ui"
import { isPageWideRefusal, PageCallError } from "../page-reads/page-call-error.js"
import { describePageFailure } from "../page-reads/describe-page-failure.js"
import { createPageReader, PAGE_READ_TTL_MS } from "../page-reads/page-reader.js"
import { ARTIFACT_PAGE_HINTS } from "./artifact-hints.js"
import { refusal, rejectWith, runtimeOf } from "./claude-runtime.test-support.js"
import {
  CLAUDE_RUNTIME_CODES,
  claudeToolCaller,
  type ClaudeMcpAnswer,
  type ClaudeRuntime,
} from "./claude-tool-caller.js"

/**
 * The page's caller over the artifact runtime, held to the contract a probe artifact verified on
 * 2026-11-25 (runtime contract 0.2.99): positional calls on the connector, the runtime's cache,
 * `payload` as the data, a tool's error resolved as its answer, the runtime's refusals in
 * pulse-ui's codes. Plain Node, over a stubbed runtime.
 */

const CONNECTOR = "Pulse"

/** What a call settles to: its result, or what it rejected with. */
const settle = (call: Promise<unknown>) => call.catch((thrown: unknown) => thrown)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("claudeToolCaller", () => {
  it("calls the tool positionally on the page's connector and reads the payload", async () => {
    const { runtime, calls, asked } = runtimeOf(() => Promise.resolve({ payload: { items: [] } }))
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    const result = await callTool("engine_process_stats", { processDefinitionKey: "p" })
    expect(result).toEqual({ structuredContent: { items: [] } })
    expect(asked).toEqual(["mcp"])
    expect(calls).toEqual([
      [
        CONNECTOR,
        "engine_process_stats",
        { processDefinitionKey: "p" },
        { cache: { staleTime: PAGE_READ_TTL_MS, gcTime: 600_000 } },
      ],
    ])
  })

  it("calls another connector where a call names one, the page's own otherwise", async () => {
    const { runtime, calls } = runtimeOf(() => Promise.resolve({ payload: {} }))
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    await callTool("crm_list_accounts", {}, { connector: "Acme CRM" })
    await callTool("engine_process_stats", {}, {})
    expect(calls.map(([server, tool]) => `${server}: ${tool}`)).toEqual([
      "Acme CRM: crm_list_accounts",
      "Pulse: engine_process_stats",
    ])
  })

  it("asks the runtime past its cache for a refresh", async () => {
    const { runtime, calls } = runtimeOf(() => Promise.resolve({ payload: {} }))
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    await callTool("engine_process_stats", {}, { refresh: true })
    await callTool("engine_process_stats", {}, { refresh: false })
    expect(calls.map((call) => call[3])).toEqual([
      { cache: { staleTime: 0, gcTime: 600_000, refresh: true } },
      { cache: { staleTime: PAGE_READ_TTL_MS, gcTime: 600_000 } },
    ])
  })

  it("keeps an answer's own parts and reads a text payload as its text", async () => {
    const answers: ClaudeMcpAnswer[] = [
      { payload: '{"activities":[]}' },
      { content: [{ type: "text", text: "plain" }] },
      { payload: null, content: [{ type: "text", text: "null" }] },
    ]
    const { runtime } = runtimeOf(() => Promise.resolve(answers.shift() ?? {}))
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    await expect(callTool("t", {})).resolves.toEqual({
      content: [{ type: "text", text: '{"activities":[]}' }],
    })
    // An answer without a payload is the result as it is, with no data of the caller's own.
    await expect(callTool("t", {})).resolves.toStrictEqual({
      content: [{ type: "text", text: "plain" }],
    })
    await expect(callTool("t", {})).resolves.toStrictEqual({
      content: [{ type: "text", text: "null" }],
    })
  })

  it.each([...CLAUDE_RUNTIME_CODES])(
    "rejects the runtime's %s as pulse-ui's %s, the code under Details, at the call's connector",
    async (code, pageCode) => {
      const { runtime } = runtimeOf(() => refusal(code, "refused", "Acme CRM"))
      const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
      const error = await settle(callTool("crm_list_accounts", {}, { connector: "Acme CRM" }))
      expect(error).toBeInstanceOf(PageCallError)
      expect(error).toMatchObject({
        code: pageCode,
        tool: "crm_list_accounts",
        connector: "Acme CRM",
        detail: `[${code}] refused`,
        message: `[${code}] refused`,
      })
    },
  )

  it("maps the seven codes the runtime is known to give", () => {
    expect(Object.fromEntries(CLAUDE_RUNTIME_CODES)).toEqual({
      needs_reauth: "needs_reauth",
      server_not_connected: "not_connected",
      selection_required: "selection_required",
      not_in_manifest: "not_allowed",
      blocked_by_policy: "not_allowed",
      approval_required: "approval_required",
      server_unavailable: "unavailable",
    } satisfies Record<string, PageErrorCode>)
  })

  it.each([
    ["another code", "tool_failed"],
    ["a name of Object's prototype", "toString"],
    ["no code", undefined],
  ])("rejects a rejection with %s as tool_error, its message alone", async (_, code) => {
    const text = "engine prod-a unreachable (ECONNREFUSED)"
    const { runtime } = runtimeOf(() => refusal(code, text))
    const error = await settle(
      claudeToolCaller({ connector: CONNECTOR, runtime })("engine_process_stats", {}),
    )
    expect(error).toBeInstanceOf(PageCallError)
    expect(error).toMatchObject({ code: "tool_error", detail: text, connector: CONNECTOR })
    // The kit classifies the engine's text, so the words name the engine, not the raw text.
    const words = describePageFailure(error, "en", { pageHints: ARTIFACT_PAGE_HINTS })
    expect(words.title).toContain("prod-a")
    expect(words.details).toBe(text)
  })

  it.each([
    ["a runtime code", { code: "needs_reauth" }, "needs_reauth", "[needs_reauth]"],
    ["another code", { code: "tool_failed" }, "tool_error", "tool_failed"],
    ["no code", {}, "tool_error", ""],
    ["a code that is no string", { code: 42 }, "tool_error", ""],
    ["a string", "runtime gone", "tool_error", "runtime gone"],
    ["null", null, "tool_error", "null"],
    ["an Error", new Error("broken"), "tool_error", "broken"],
  ])(
    "rejects a rejection without a message of its own (%s) by what it carries",
    async (_, thrown, code, detail) => {
      const { runtime } = runtimeOf(() => rejectWith(thrown))
      const error = await settle(
        claudeToolCaller({ connector: CONNECTOR, runtime })("engine_process_stats", {}),
      )
      expect(error).toBeInstanceOf(PageCallError)
      expect(error).toMatchObject({ code, detail })
    },
  )

  it("resolves a tool's own error as the answer it is, a synthesized one without a result", async () => {
    const text = 'Invalid arguments for tool engine_activity_counts: Unknown key "n".'
    const answer = { content: [{ type: "text", text }], isError: true }
    const rejections: unknown[] = [
      { code: "tool_error", server: CONNECTOR, message: text, result: answer },
      { code: "tool_error", server: CONNECTOR, message: text, result: { content: [] } },
      { code: "tool_error", server: CONNECTOR, message: text, result: null },
      { code: "tool_error", server: CONNECTOR, message: text },
    ]
    const { runtime, uses } = runtimeOf(() => rejectWith(rejections.shift()))
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    await expect(callTool("engine_activity_counts", { n: 1 })).resolves.toBe(answer)
    for (let left = 3; left > 0; left--) {
      await expect(callTool("engine_activity_counts", { n: 1 })).resolves.toEqual({
        isError: true,
        content: [{ type: "text", text }],
      })
    }
    // A tool's answer is no refusal: the capability stays.
    expect(uses()).toBe(1)
  })

  it("reads the runtime's answer and a tool's error as the probe of 2026-11-25 saw them", async () => {
    const data = { asOf: "2026-11-25T09:00:00.000Z", activities: [{ activityId: "a" }] }
    const text = 'Invalid arguments for tool engine_activity_counts: Unknown key "n".'
    const answers: Record<string, () => Promise<ClaudeMcpAnswer>> = {
      // A result with `payload`, the tool's JSON, next to its `structuredContent`.
      1: () =>
        Promise.resolve({
          _meta: { mimeType: "application/json" },
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
          payload: data,
        } as ClaudeMcpAnswer),
      // A tool that answers text only.
      2: () => Promise.resolve({ payload: '{"activities":[]}' }),
      // A tool's error (here strict input) rejects as `tool_error` with the tool's result.
      3: () =>
        rejectWith({
          code: "tool_error",
          server: CONNECTOR,
          message: text,
          result: { content: [{ type: "text", text }], isError: true },
        }),
    }
    const unanswered = () => refusal("tool_failed", "no answer recorded")
    const { runtime } = runtimeOf((_, _tool, args) => (answers[String(args.n)] ?? unanswered)())
    const reader = createPageReader(claudeToolCaller({ connector: CONNECTOR, runtime }))
    const call = (n: number) => reader.call("engine_activity_counts", { n })
    await expect(call(1)).resolves.toEqual(data)
    await expect(call(2)).resolves.toEqual({ activities: [] })
    const error = await settle(call(3))
    expect(error).toMatchObject({ name: "ToolResultError", message: text })
    // The server's strict-input refusal, worded by the kit with the artifact's hints: no retry
    // changes it, and the raw text shows under Details only.
    expect(describePageFailure(error, "en", { pageHints: ARTIFACT_PAGE_HINTS })).toEqual({
      title: "The server refused this request",
      hint: ARTIFACT_PAGE_HINTS.en.invalidArguments,
      details: text,
      permanent: true,
    })
  })

  const NO_CAPABILITY =
    'window.claude.use("mcp") gave no capability: the page declares no mcp capability.'

  it.each([
    ["no use", {}, "window.claude.use is missing: the page runs outside a Claude artifact."],
    ["a use that rejects", { use: () => rejectWith(new Error("no mcp here")) }, "no mcp here"],
    ["a use that rejects with a code of its own", { use: () => rejectWith({ code: "x" }) }, "x"],
  ] as [string, ClaudeRuntime, string][])(
    "rejects %s as a page without a connector",
    async (_, runtime, detail) => {
      const error = await settle(
        claudeToolCaller({ connector: CONNECTOR, runtime })("engine_process_stats", {}),
      )
      expect(error).toBeInstanceOf(PageCallError)
      expect(error).toMatchObject({
        code: "not_connected",
        tool: "engine_process_stats",
        connector: CONNECTOR,
        detail,
      })
    },
  )

  it.each([
    ["null", { use: () => Promise.resolve(null) }],
    ["undefined", { use: () => Promise.resolve(undefined) }],
  ] as [string, ClaudeRuntime][])(
    "rejects no capability (%s) as a page that declares none, which only its publisher can change",
    async (_, runtime) => {
      const error = await settle(
        claudeToolCaller({ connector: CONNECTOR, runtime })("engine_process_stats", {}),
      )
      expect(error).toBeInstanceOf(PageCallError)
      expect(error).toMatchObject({
        code: "not_declared",
        tool: "engine_process_stats",
        connector: CONNECTOR,
        detail: NO_CAPABILITY,
      })
      // Still the page's one state (as before), now worded for whoever published the page, with
      // no Try again.
      expect(isPageWideRefusal(error)).toBe(true)
      expect(describePageFailure(error, "en", { pageHints: ARTIFACT_PAGE_HINTS })).toEqual({
        title: "This page isn't set up to use Pulse",
        hint: "Only whoever published the page can set up its connection to Pulse. Ask them.",
        details: NO_CAPABILITY,
        permanent: true,
      })
    },
  )

  it("words a connector to set up, one to choose and a page without a declaration apart, each page-wide as before", async () => {
    const wordsOf = async (runtime: ClaudeRuntime) => {
      const error = await settle(
        claudeToolCaller({ connector: CONNECTOR, runtime })("engine_process_stats", {}),
      )
      expect(isPageWideRefusal(error)).toBe(true)
      return describePageFailure(error, "de", { pageHints: ARTIFACT_PAGE_HINTS })
    }
    const missing = await wordsOf(runtimeOf(() => refusal("server_not_connected", "x")).runtime)
    const choose = await wordsOf(runtimeOf(() => refusal("selection_required", "x")).runtime)
    const undeclared = await wordsOf({ use: () => Promise.resolve(null) })
    expect(missing.hint).toBe(
      "Richte Pulse in claude.ai in den Einstellungen unter Connectors ein und versuch es dann noch mal.",
    )
    expect(choose).toEqual({
      title: "Diese Seite wartet darauf, dass du ihre Verbindung zu Pulse wählst",
      hint: "Wähl die Verbindung zu Pulse, die die Seite nutzen soll, wenn du gefragt wirst, und versuch es dann noch mal.",
      details: "[selection_required] x",
    })
    expect(undeclared.title).toBe("Diese Seite ist nicht dafür eingerichtet, Pulse zu nutzen")
    expect(undeclared.permanent).toBe(true)
    expect(new Set([missing.title, choose.title, undeclared.title]).size).toBe(3)
  })

  it("rejects a use that the runtime refuses with its code, as the runtime's refusal", async () => {
    const runtime: ClaudeRuntime = { use: () => refusal("approval_required", "allow it") }
    const error = await settle(
      claudeToolCaller({ connector: CONNECTOR, runtime })("engine_process_stats", {}),
    )
    expect(error).toMatchObject({
      code: "approval_required",
      detail: "[approval_required] allow it",
    })
  })

  it("reads the artifact's window.claude at the first call, none as a page outside an artifact", async () => {
    const callTool = claudeToolCaller({ connector: CONNECTOR })
    await expect(settle(callTool("engine_process_stats", {}))).resolves.toMatchObject({
      code: "not_connected",
      detail: "window.claude.use is missing: the page runs outside a Claude artifact.",
    })
    const { runtime, calls } = runtimeOf(() => Promise.resolve({ payload: { ok: true } }))
    vi.stubGlobal("claude", runtime)
    await expect(callTool("engine_process_stats", {})).resolves.toEqual({
      structuredContent: { ok: true },
    })
    expect(calls).toHaveLength(1)
  })

  it("names each call's own connector and tool in a refusal of the capability they share", async () => {
    const runtime: ClaudeRuntime = { use: () => Promise.resolve(null) }
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    const errors = await Promise.all([
      settle(callTool("engine_process_stats", {})),
      settle(callTool("crm_list_accounts", {}, { connector: "Acme CRM" })),
    ])
    expect(errors.map((error) => error instanceof PageCallError && error.connector)).toEqual([
      CONNECTOR,
      "Acme CRM",
    ])
    expect(errors.map((error) => error instanceof PageCallError && error.tool)).toEqual([
      "engine_process_stats",
      "crm_list_accounts",
    ])
  })

  it("asks the runtime anew after a refusal, never after the server's error", async () => {
    let next: () => Promise<ClaudeMcpAnswer> = () => refusal("selection_required", "pick one")
    const { runtime, uses } = runtimeOf(() => next())
    const callTool = claudeToolCaller({ connector: CONNECTOR, runtime })
    await expect(callTool("engine_process_stats", {})).rejects.toMatchObject({
      code: "selection_required",
    })
    expect(uses()).toBe(1)
    next = () => refusal(undefined, "[503] down")
    await expect(callTool("engine_process_stats", {})).rejects.toMatchObject({
      code: "tool_error",
    })
    next = () => refusal("tool_error", "[503] down")
    await expect(callTool("engine_process_stats", {})).resolves.toMatchObject({ isError: true })
    next = () => Promise.resolve({ payload: { ok: true } })
    await expect(callTool("engine_process_stats", {})).resolves.toEqual({
      structuredContent: { ok: true },
    })
    expect(uses()).toBe(2)
  })
})
