import { describe, expect, it } from "vitest"
import { createInMemoryProfileStore, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import { localizeFor, localizeViewFor, resolveLocale, viewLocaleOf } from "./server-locale.js"

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
    expect(t("profile.heading")).toBe("Engines und Dashboards")
  })

  it("still returns a working translate when the store is down", async () => {
    const t = await localizeFor(outageStore, CTX)
    expect(t("profile.heading")).toBe("Engines and dashboards")
  })
})

describe("localizeViewFor", () => {
  it("titles the view in the language the profile names", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { language: "de" })
    const { t, title } = await localizeViewFor(store, CTX)
    expect(title("viewTitle.processList")).toBe("Prozessdefinitionen")
    expect(title("viewTitle.clusterDetail", { activity: "ship" })).toBe("Cluster: ship")
    expect(t("profile.heading")).toBe("Engines und Dashboards")
  })

  it("an English profile gets the English title", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { language: "en" })
    const { title } = await localizeViewFor(store, CTX)
    expect(title("viewTitle.processList")).toBe("Process definitions")
  })

  // "system" follows the HOST's locale, which only the widget sees: the
  // server sets no title rather than an English one over a German view.
  it("sets no title while the profile follows the host, and summarizes in English", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { language: "system" })
    const { t, title } = await localizeViewFor(store, CTX)
    expect(title("viewTitle.processList")).toBeUndefined()
    expect(t("profile.heading")).toBe("Engines and dashboards")
  })

  it("a language already read titles the same way (the settings view's own record)", () => {
    expect(viewLocaleOf("de").title("viewTitle.settings")).toBe("Engines und Dashboards")
    expect(viewLocaleOf("en").title("viewTitle.settings")).toBe("Engines and dashboards")
    for (const language of ["system", undefined, "fr"]) {
      expect(viewLocaleOf(language).title("viewTitle.settings")).toBeUndefined()
      expect(viewLocaleOf(language).t("viewTitle.settings")).toBe("Engines and dashboards")
    }
  })

  it("no store, no caller or a store outage reads as the host's locale: no title", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { language: "de" })
    for (const view of [
      await localizeViewFor(undefined, CTX),
      await localizeViewFor(store),
      await localizeViewFor(outageStore, CTX),
    ]) {
      expect(view.title("viewTitle.processList")).toBeUndefined()
      expect(view.t("profile.heading")).toBe("Engines and dashboards")
    }
  })
})
