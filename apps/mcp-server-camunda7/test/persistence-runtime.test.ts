import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createDefaultProfileStore, initRuntime } from "../src/persistence/index.js"

const env = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...overrides })

describe("initRuntime (non-database path)", () => {
  it("selects the in-memory store and a resolvable shutdown when nothing is configured", async () => {
    const runtime = await initRuntime(env())
    // No database → nothing for /health/ready to verify.
    expect(runtime.readiness).toEqual({})
    await expect(runtime.profileStore.get("nobody")).resolves.toBeUndefined()
    await runtime.shutdown()
  })

  it("selects the filesystem store when MCP_PROFILE_DIR is set", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      const dir = mkdtempSync(path.join(tmpdir(), "mcp-profile-"))
      const runtime = await initRuntime(env({ MCP_PROFILE_DIR: dir }))
      await runtime.profileStore.save("alice", { language: "de" })
      // A second boot over the same directory reads what the first one saved.
      const restarted = await initRuntime(env({ MCP_PROFILE_DIR: dir }))
      await expect(restarted.profileStore.get("alice")).resolves.toMatchObject({ language: "de" })
      await runtime.shutdown()
      await restarted.shutdown()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("warns LOUDLY when a production boot keeps the profiles in memory", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const runtime = await initRuntime(env({ NODE_ENV: "production" }))
      expect(log).toHaveBeenCalledWith("[pulse] persistence: profiles=memory")
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/user profiles are kept IN MEMORY.*Set DATABASE_URL/),
      )
      await runtime.shutdown()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("announces filesystem persistence without a warning, and stays quiet outside production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const dir = mkdtempSync(path.join(tmpdir(), "mcp-profile-"))
      const durable = await initRuntime(env({ NODE_ENV: "production", MCP_PROFILE_DIR: dir }))
      expect(log).toHaveBeenCalledWith("[pulse] persistence: profiles=filesystem")
      const dev = await initRuntime(env())
      expect(warn).not.toHaveBeenCalled()
      await durable.shutdown()
      await dev.shutdown()
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe("initRuntime (database path)", () => {
  it("fails the boot on a DATABASE_URL it cannot reach — never degrades to the dir knob or memory", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      // Port 1 on loopback refuses at once: the migrations are the first query.
      await expect(
        initRuntime(
          env({
            DATABASE_URL: "postgres://miragon:miragon@127.0.0.1:1/miragon",
            MCP_PROFILE_DIR: "/nonexistent/profiles",
          }),
        ),
      ).rejects.toThrow()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("DATABASE_URL is set — ignoring MCP_PROFILE_DIR"),
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe("createDefaultProfileStore", () => {
  it("falls back to the in-memory store without MCP_PROFILE_DIR", async () => {
    const store = createDefaultProfileStore(env())
    await expect(store.get("missing")).resolves.toBeUndefined()
  })
})
