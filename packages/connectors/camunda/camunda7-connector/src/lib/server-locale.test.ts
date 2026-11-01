import { describe, expect, it } from "vitest"
import { createInMemoryProfileStore, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import { localizeFor, resolveLocale } from "./server-locale.js"

/** A signed-in caller's handler ctx — whose record the lookup reads. */
const CTX = { auth: { user: { id: "user-1" } } }

const outageStore: ProfileStore = {
  get: () => Promise.reject(new Error("connection refused")),
  save: () => Promise.reject(new Error("connection refused")),
  delete: () => Promise.reject(new Error("connection refused")),
}

describe("resolveLocale", () => {
  it("reads the language off the profile record", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { language: "de" })
    expect(await resolveLocale(store, CTX)).toBe("de")
    // Without a caller identity there is no record to read.
    expect(await resolveLocale(store)).toBe("en")
  })

  it("falls back to English on a store OUTAGE (must not fail engine-backed tools)", async () => {
    // With DATABASE_URL a store hiccup may only cost the translation, never the tool result.
    expect(await resolveLocale(outageStore, CTX)).toBe("en")
  })
})

describe("localizeFor", () => {
  it("binds the translate to the profile language", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { language: "de" })
    const t = await localizeFor(store, CTX)
    expect(t("profile.heading")).toBe("Engine-Einstellungen")
  })

  it("still returns a working translate when the store is down", async () => {
    const t = await localizeFor(outageStore, CTX)
    expect(t("profile.heading")).toBe("Engine settings")
  })
})
