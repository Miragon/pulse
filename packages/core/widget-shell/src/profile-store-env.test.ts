import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  announcePersistence,
  persistenceFromEnv,
  profileStoreFromEnv,
} from "./profile-store-env.js"

describe("persistenceFromEnv", () => {
  it("reports the non-database selection", () => {
    expect(persistenceFromEnv({})).toEqual({ profiles: "memory" })
    expect(persistenceFromEnv({ MCP_PROFILE_DIR: "/p" })).toEqual({ profiles: "filesystem" })
  })
})

describe("announcePersistence", () => {
  const capture = () => ({
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  })

  it("logs the selected backend on every path", () => {
    const { log, warn } = capture()
    announcePersistence(
      { profiles: "postgres" },
      { env: { NODE_ENV: "production" }, label: "root" },
    )
    expect(log).toHaveBeenCalledWith("[root] persistence: profiles=postgres")
    expect(warn).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it("warns LOUDLY when a production process keeps the profiles in memory", () => {
    const { warn } = capture()
    announcePersistence(
      { profiles: "memory" },
      { env: { NODE_ENV: "production" }, label: "root", remedy: "Set DATABASE_URL." },
    )
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe(
      "[root] WARNING: user profiles are kept IN MEMORY in a production process — every restart, redeploy or scale-to-zero stop silently drops them. Set DATABASE_URL.",
    )

    announcePersistence({ profiles: "memory" }, { env: { NODE_ENV: "production" } })
    expect(warn.mock.calls[1][0]).toMatch(/^\[persistence\] WARNING: user profiles are kept/)
    expect(warn.mock.calls[1][0]).toContain("Set MCP_PROFILE_DIR to a directory")
    announcePersistence({ profiles: "filesystem" }, { env: { NODE_ENV: "production" } })
    expect(warn).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it("stays quiet outside production (dev, tests)", () => {
    const { warn } = capture()
    announcePersistence({ profiles: "memory" }, { env: {} })
    announcePersistence({ profiles: "memory" }, { env: { NODE_ENV: "development" } })
    expect(warn).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe("profileStoreFromEnv", () => {
  it("selects the filesystem store when MCP_PROFILE_DIR is set (records persist)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-env-"))
    const store = profileStoreFromEnv({ MCP_PROFILE_DIR: dir })
    await store.save("user-1", { language: "de" })
    // A SECOND store over the same dir sees the record — proof it hit disk.
    expect((await profileStoreFromEnv({ MCP_PROFILE_DIR: dir }).get("user-1"))?.language).toBe("de")
  })

  it("falls back to the in-memory store without the env knob", async () => {
    const store = profileStoreFromEnv({})
    await store.save("user-1", { language: "de" })
    // A second instance shares nothing — proof it stayed in-process.
    expect(await profileStoreFromEnv({}).get("user-1")).toBeUndefined()
  })
})
