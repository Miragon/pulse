import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Client } from "@modelcontextprotocol/client"
import {
  bootServer,
  connectClient,
  createTestRuntime,
  TEST_TOKENS,
  type BootedServer,
} from "./boot-server.js"

/** The JSON a tool result carries as its text block. */
function payload(result: { content?: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text?: string }> | undefined
  const text = content?.find((c) => c.type === "text")?.text
  expect(text, "tool result should carry a text content block").toBeTruthy()
  return JSON.parse(text!) as Record<string, unknown>
}

/** The error text of a refused tool call. */
function refusal(result: { isError?: unknown; content?: unknown }): string {
  expect(result.isError, "the call must be refused").toBe(true)
  const content = result.content as Array<{ type: string; text?: string }>
  return content.map((c) => c.text ?? "").join("\n")
}

const call = (client: Client, name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args })

/**
 * WHOSE profile a request touches, decided on the wire against the real
 * composition (`createApp`). Identity comes from the server's own OAuth only:
 * a header the client chooses itself (`Mcp-Session-Id`) is not a caller
 * identity — trusting it let anyone who knew or guessed a key read and
 * retarget that record — and two signed-in users never share one record.
 */
describe("caller identity on the wire (createApp)", () => {
  describe("without OAuth, a client-supplied Mcp-Session-Id resolves no identity", () => {
    /** The key the removed session rung would have resolved for this header. */
    const SESSION = "victim-session"
    const runtime = createTestRuntime()
    let server: BootedServer
    let client: Client

    beforeAll(async () => {
      await runtime.profileStore.save(SESSION, {
        language: "de",
        modules: { analytics: { defaultPeriod: "30d" }, camunda7: { allowedEngineIds: ["x"] } },
      })
      // Explicit write toolsets: the save tools exist, so only identity can refuse them.
      server = await bootServer({
        env: { MCP_ACTIVE_MODULES: "camunda7:operations,analytics:standard" },
        runtime,
      })
      client = await connectClient(server.port, undefined, { "Mcp-Session-Id": SESSION })
    })

    afterAll(async () => {
      await client?.close()
      await server?.close()
    })

    it("reads fall back to the defaults and hide Save", async () => {
      expect(payload(await call(client, "shell_settings_data"))).toEqual({
        language: "system",
        canSave: false,
        readOnlyReason: "noSignIn",
      })
      const camunda7 = payload(await call(client, "camunda7_settings_data"))
      expect(camunda7).toMatchObject({ canSave: false })
      expect(camunda7.profile).not.toHaveProperty("allowedEngineIds")

      const analytics = payload(await call(client, "analytics_settings_data"))
      expect(analytics).toEqual({
        canSave: false,
        settings: { defaultPeriod: "7d", minBucketSize: 10 },
      })
    })

    it("every profile write refuses and no record changes", async () => {
      const before = await runtime.profileStore.get(SESSION)

      expect(
        refusal(await call(client, "camunda7_save_settings", { allowedEngineIds: ["default"] })),
      ).toMatch(/No caller identity/)
      expect(refusal(await call(client, "analytics_save_settings", { minBucketSize: 3 }))).toMatch(
        /No caller identity/,
      )
      expect(
        refusal(await call(client, "camunda7_select_engine", { engineId: "default" })),
      ).toMatch(/No caller identity/)

      // The language save is a framework write: without OAuth it does not exist.
      const tools = (await client.listTools()).tools.map((tool) => tool.name)
      expect(tools).toContain("shell_settings_data")
      expect(tools).not.toContain("shell_save_settings")

      expect(await runtime.profileStore.get(SESSION)).toEqual(before)
      // Nor does a keyless write fall back to a shared record.
      expect(await runtime.profileStore.get("anonymous")).toBeUndefined()
    })
  })

  describe("under OAuth, every user owns exactly their record", () => {
    const runtime = createTestRuntime()
    let server: BootedServer
    let alice: Client
    let bob: Client

    beforeAll(async () => {
      server = await bootServer({ authenticated: true, runtime })
      alice = server.client
      bob = await connectClient(server.port, TEST_TOKENS.bob)
    })

    afterAll(async () => {
      await bob?.close()
      await server?.close()
    })

    it("keeps two users' profiles apart — a save of one never touches the other", async () => {
      expect((await call(alice, "shell_save_settings", { language: "de" })).isError).toBeFalsy()
      expect(
        (await call(alice, "analytics_save_settings", { defaultPeriod: "30d" })).isError,
      ).toBeFalsy()

      // Bob starts from the defaults — Alice's saves are not his.
      expect(payload(await call(bob, "shell_settings_data"))).toMatchObject({
        canSave: true,
        language: "system",
      })
      expect(payload(await call(bob, "analytics_settings_data"))).toMatchObject({
        canSave: true,
        settings: { defaultPeriod: "7d" },
      })

      expect((await call(bob, "shell_save_settings", { language: "en" })).isError).toBeFalsy()

      // Alice's record is untouched by Bob's save, and vice versa.
      expect(payload(await call(alice, "shell_settings_data"))).toMatchObject({ language: "de" })
      expect(payload(await call(alice, "analytics_settings_data"))).toMatchObject({
        settings: { defaultPeriod: "30d" },
      })

      // Keyed by the token subject (the provider maps it as `user.id` only).
      const aliceRecord = await runtime.profileStore.get("alice")
      const bobRecord = await runtime.profileStore.get("bob")
      expect(aliceRecord).toMatchObject({ language: "de", userId: "alice" })
      expect(aliceRecord?.modules).toMatchObject({ analytics: { defaultPeriod: "30d" } })
      expect(bobRecord).toMatchObject({ language: "en", userId: "bob" })
      expect(bobRecord?.modules).not.toHaveProperty("analytics")
    })

    it("saves a default engine for the caller alone (camunda7_select_engine / _list_engines)", async () => {
      expect(
        (await call(alice, "camunda7_select_engine", { engineId: "default" })).isError,
      ).toBeFalsy()
      expect(payload(await call(alice, "camunda7_list_engines"))).toMatchObject({
        defaultEngineId: "default",
      })
      expect(payload(await call(bob, "camunda7_list_engines"))).toMatchObject({
        defaultEngineId: null,
      })
      expect((await runtime.profileStore.get("alice"))?.modules).toMatchObject({
        camunda7: { defaultEngineId: "default" },
      })
    })
  })
})
