import { describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { createInMemoryProfileStore, type ProfileStore } from "./profile-store.js"
import { runWithMcpRequestInfo } from "./request-context.js"
import { createShellPlugin } from "./shell-catalogue.js"
import {
  SHELL_SAVE_SETTINGS,
  SHELL_SETTINGS_DATA,
  SHELL_SHOW_SETTINGS,
} from "./shell-settings-contract.js"
import { registerShellSettingsTools } from "./shell-settings.js"

/** The save exists only where the composition root allows framework writes (#346). */

const CTX = { auth: { user: { id: "user-1" } } }

type Handler = (
  params: unknown,
  ctx?: unknown,
) => Promise<{
  structuredContent?: Record<string, unknown>
  content: Array<{ type: string; text: string }>
}>

function register(allowSave: boolean, store: ProfileStore = createInMemoryProfileStore()) {
  const tool = vi.fn()
  registerShellSettingsTools({ tool } as unknown as MCPServer, { profileStore: store, allowSave })
  const call = (name: string) =>
    tool.mock.calls.find((c) => (c[0] as { name: string }).name === name)
  return {
    store,
    names: tool.mock.calls.map((c) => (c[0] as { name: string }).name),
    definition: (name: string) => call(name)?.[0] as Record<string, unknown>,
    handler: (name: string) => call(name)?.[1] as Handler,
  }
}

const dataOf = async (handler: Handler, ctx?: unknown) =>
  JSON.parse((await handler({}, ctx)).content[0]?.text ?? "null") as Record<string, unknown>

describe("the shell's settings triple", () => {
  it("registers the save only where framework writes are allowed", () => {
    expect(register(true).names).toEqual([
      SHELL_SHOW_SETTINGS,
      SHELL_SETTINGS_DATA,
      SHELL_SAVE_SETTINGS,
    ])
    expect(register(false).names).toEqual([SHELL_SHOW_SETTINGS, SHELL_SETTINGS_DATA])
  })

  it("reads the defaults, read-only, for a request without a caller", async () => {
    const { handler } = register(true)
    expect(await dataOf(handler(SHELL_SETTINGS_DATA))).toEqual({
      language: "system",
      canSave: false,
      readOnlyReason: "noSignIn",
    })
  })

  it("names the deployment as the reason when a signed-in caller still cannot save", async () => {
    const { handler } = register(false)
    expect(await dataOf(handler(SHELL_SETTINGS_DATA), CTX)).toEqual({
      language: "system",
      canSave: false,
      readOnlyReason: "readOnly",
    })
  })

  it("saves the language on the record, leaves module slices alone and reads it back", async () => {
    const { handler, store } = register(true)
    await store.save("user-1", { modules: { analytics: { defaultPeriod: "30d" } } })

    const saved = await handler(SHELL_SAVE_SETTINGS)({ language: "de" }, CTX)

    expect(saved.content[0]?.text).toBe("Sprache der Oberfläche gespeichert: Deutsch.")
    expect(saved.structuredContent).toEqual({ language: "de", canSave: true, readOnlyReason: null })
    const record = await store.get("user-1")
    expect(record?.language).toBe("de")
    expect(record?.userId).toBe("user-1")
    expect(record?.modules).toEqual({ analytics: { defaultPeriod: "30d" } })
    expect(await dataOf(handler(SHELL_SETTINGS_DATA), CTX)).toMatchObject({
      language: "de",
      canSave: true,
    })
  })

  it("renders the page, titled and summarized in the profile's language", async () => {
    const { handler, store } = register(true)
    await store.save("user-1", { language: "de" })

    const result = await runWithMcpRequestInfo({}, () => handler(SHELL_SHOW_SETTINGS)({}, CTX))

    expect(result.content[0]?.text).toBe(
      "Einstellungen: Sprache der Oberfläche Deutsch, danach der Abschnitt jedes Moduls. Du kannst sie auf der Seite ändern oder den Chat darum bitten.",
    )
    expect(JSON.stringify(result.structuredContent)).toContain('"shell:settings-page"')
    expect(result.structuredContent?.title).toBe("Einstellungen")
  })

  it("sets no title over the page while the profile follows the chat app", async () => {
    const { handler } = register(false)
    const result = await handler(SHELL_SHOW_SETTINGS)({}, CTX)
    expect(result.structuredContent?.title).toBeUndefined()
    expect(result.content[0]?.text).toBe(
      "Settings page: UI language automatic (follows the chat app), then each module's settings section. Settings can't be saved on this server.",
    )
  })
})

describe("createShellPlugin", () => {
  it("registers no tools without a profile store", () => {
    expect(createShellPlugin().registerWidgetTools).toBeUndefined()
  })

  it("registers the triple with one", () => {
    const tool = vi.fn()
    createShellPlugin({
      profileStore: createInMemoryProfileStore(),
      allowSave: false,
    }).registerWidgetTools?.({ tool } as unknown as MCPServer)
    expect(tool.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([
      SHELL_SHOW_SETTINGS,
      SHELL_SETTINGS_DATA,
    ])
  })
})
