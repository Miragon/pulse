import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { MCPServer } from "mcp-use"
import { runWithMcpRequestInfo } from "./request-context.js"
import { registerSettingsSection, type SettingsGate } from "./settings-section.js"

const CTX = { auth: { user: { id: "user-1" } } }

type Result = {
  structuredContent?: Record<string, unknown>
  content?: Array<{ type: string; text: string }>
  isError?: boolean
}

interface Options {
  withSave?: boolean
  withReason?: boolean
  annotations?: Record<string, boolean>
}

function register({ withSave = true, withReason = true, annotations }: Options = {}) {
  const tool = vi.fn()
  const write = vi.fn((params: { level?: number }, owner: { key: string; userId?: string }) =>
    Promise.resolve({
      text: `saved ${params.level} for ${owner.key}`,
      saved: { level: params.level },
    }),
  )
  registerSettingsSection({ tool } as unknown as MCPServer, {
    app: "demo",
    widget: "demo:settings",
    openWorldHint: true,
    readOnlyReason: withReason ? "toolset" : undefined,
    load: (_ctx, key, gate: SettingsGate<"toolset">) =>
      Promise.resolve({ view: { key: key ?? null, ...gate }, language: "de" as const }),
    show: {
      name: "demo_show_settings",
      title: "Demo settings",
      description: "Open the demo settings.",
      render: ({ view, language }) => ({ title: language, summary: JSON.stringify(view) }),
    },
    feed: { name: "demo_settings_data", title: "Demo data", description: "Feed." },
    save: withSave
      ? {
          name: "demo_save_settings",
          title: "Save demo settings",
          description: "Save them.",
          input: { level: z.number().optional() },
          annotations,
          write,
        }
      : undefined,
  })
  const definition = (name: string) =>
    tool.mock.calls.find((c) => (c[0] as { name: string }).name === name)?.[0] as Record<
      string,
      unknown
    >
  const handler = (name: string) =>
    tool.mock.calls.find((c) => (c[0] as { name: string }).name === name)?.[1] as (
      params: unknown,
      ctx?: unknown,
    ) => Promise<Result>
  const names = tool.mock.calls.map((c) => (c[0] as { name: string }).name)
  return { names, definition, handler, write }
}

const feed = async (handler: ReturnType<typeof register>["handler"], ctx?: unknown) =>
  JSON.parse((await handler("demo_settings_data")({}, ctx)).content?.[0]?.text ?? "null") as Record<
    string,
    unknown
  >

describe("registerSettingsSection", () => {
  it("registers the save tool only when the module's gate gives one", () => {
    expect(register().names).toEqual([
      "demo_show_settings",
      "demo_settings_data",
      "demo_save_settings",
    ])
    expect(register({ withSave: false }).names).toEqual([
      "demo_show_settings",
      "demo_settings_data",
    ])
  })

  it("binds the show tool to its view, keeps the feed app-only and the save a plain tool", () => {
    const { definition } = register()
    const show = definition("demo_show_settings")
    expect(show.view).toMatchObject({ name: "demo_show_settings" })
    expect(show.outputSchema).toBeDefined()
    expect(show._meta).toMatchObject({
      "openai/outputTemplate": "ui://views/demo_show_settings.html",
    })
    const data = definition("demo_settings_data")
    expect(data.visibility).toBe("app")
    expect(data.view).toBeUndefined()
    expect((data._meta as Record<string, unknown>)["openai/outputTemplate"]).toBeUndefined()
    const save = definition("demo_save_settings")
    expect([save.view, save.visibility, save._meta]).toEqual([undefined, undefined, undefined])
  })

  it("states every hint: the views read, the save writes and destroys nothing", () => {
    const read = { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    const { definition } = register()
    expect(definition("demo_show_settings").annotations).toEqual(read)
    expect(definition("demo_settings_data").annotations).toEqual(read)
    expect(definition("demo_save_settings").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    const own = { destructiveHint: false, idempotentHint: true, openWorldHint: false }
    expect(register({ annotations: own }).definition("demo_save_settings").annotations).toBe(own)
  })

  const callers = {
    "signed in": <T>(fn: (ctx?: unknown) => T): T => fn(CTX),
    "declared local caller": <T>(fn: (ctx?: unknown) => T): T =>
      runWithMcpRequestInfo({ anonymousCaller: true }, () => fn()),
    "no sign-in": <T>(fn: (ctx?: unknown) => T): T => runWithMcpRequestInfo({}, () => fn()),
  }
  it.each([
    [false, "signed in", false, "toolset"],
    [false, "declared local caller", false, "toolset"],
    [false, "no sign-in", false, "noSignIn"],
    [true, "signed in", true, null],
    [true, "declared local caller", true, null],
    [true, "no sign-in", false, "noSignIn"],
  ] as const)("save %s, %s: canSave %s, reason %s", async (withSave, caller, canSave, reason) => {
    const { handler } = register({ withSave })
    const view = await callers[caller]((ctx) => feed(handler, ctx))
    expect(view).toMatchObject({ canSave, readOnlyReason: reason })
  })

  it("reports no reason for a section that declares none", async () => {
    const { handler } = register({ withReason: false })
    expect(await feed(handler, CTX)).toEqual({ key: "user-1", canSave: true })
  })

  it("renders the section's view with the module's title and summary", async () => {
    const result = await register().handler("demo_show_settings")({}, CTX)
    expect(result.content?.[0]?.text).toBe(
      JSON.stringify({ key: "user-1", canSave: true, readOnlyReason: null }),
    )
    expect(result.structuredContent).toMatchObject({
      title: "de",
      layout: [{ row: [{ widget: "demo:settings" }] }],
      context: { stepData: { result: { _app: "demo", _dataType: "demo:settings" } } },
    })
  })

  it("saves under the caller's key, stamps the OAuth caller as owner and returns the save", async () => {
    const { handler, write } = register()
    const saved = await runWithMcpRequestInfo({ authUserId: "user-7" }, () =>
      handler("demo_save_settings")({ level: 3 }),
    )
    expect(write.mock.calls[0]?.[1]).toEqual({ key: "user-7", userId: "user-7" })
    expect(saved).toEqual({
      content: [{ type: "text", text: "saved 3 for user-7" }],
      structuredContent: { level: 3 },
    })
  })

  it("refuses a save without a caller, pointing at MCP_OAUTH", async () => {
    const { handler, write } = register()
    const refused = await runWithMcpRequestInfo({}, () =>
      handler("demo_save_settings")({ level: 3 }),
    )
    expect(refused.isError).toBe(true)
    expect(refused.content?.[0]?.text).toContain("MCP_OAUTH")
    expect(write).not.toHaveBeenCalled()
  })
})
