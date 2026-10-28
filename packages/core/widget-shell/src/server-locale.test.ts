import { describe, expect, it, vi } from "vitest"
import {
  createLocalizeFor,
  createLocalizeViewFor,
  createViewLocaleOf,
  resolveProfileLocale,
} from "./server-locale.js"
import { runWithMcpRequestInfo } from "./request-context.js"
import type { ProfileSource } from "./profile.js"

const storeWith = (language?: string): ProfileSource => ({
  get: () => Promise.resolve({ language }),
})

const CTX = { auth: { user: { id: "user-1" } } }

describe("resolveProfileLocale", () => {
  it("reads the caller's profile language", async () => {
    expect(await resolveProfileLocale(storeWith("de"), CTX)).toBe("de")
  })

  it("falls back to English without a store, without a stored language, and without a key", async () => {
    expect(await resolveProfileLocale(undefined, CTX)).toBe("en")
    expect(await resolveProfileLocale(storeWith(undefined), CTX)).toBe("en")
    // No identity: no request context at all, or an HTTP request without OAuth.
    expect(await resolveProfileLocale(storeWith("de"))).toBe("en")
    expect(await runWithMcpRequestInfo({}, () => resolveProfileLocale(storeWith("de")))).toBe("en")
  })

  it("reads the system preference — and a locale this build ships no catalog for — as English", async () => {
    // The host locale `system` follows is a widget-side signal the server never sees.
    expect(await resolveProfileLocale(storeWith("system"), CTX)).toBe("en")
    expect(await resolveProfileLocale(storeWith("fr"), CTX)).toBe("en")
  })

  it("degrades to English on a store OUTAGE instead of failing the tool", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const broken: ProfileSource = { get: () => Promise.reject(new Error("pg down")) }
    expect(await resolveProfileLocale(broken, CTX)).toBe("en")
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe("createLocalizeFor", () => {
  const translator = (locale: string, key: string, params?: Record<string, unknown>) =>
    `${locale}:${key}${params ? `:${JSON.stringify(params)}` : ""}`

  it("binds the module translator to the resolved locale", async () => {
    const localizeFor = createLocalizeFor(translator)
    const t = await localizeFor(storeWith("de"), CTX)
    expect(t("greeting")).toBe("de:greeting")
    expect(t("count", { n: 2 })).toBe('de:count:{"n":2}')
  })

  it("localizes to English when no store is wired", async () => {
    const t = await createLocalizeFor(translator)()
    expect(t("greeting")).toBe("en:greeting")
  })
})

/** #322 U3: "system" carries no title rather than an English one over a German view. */
describe("createLocalizeViewFor / createViewLocaleOf", () => {
  const translator = (locale: string, key: string, params?: Record<string, unknown>) =>
    `${locale}:${key}${params ? `:${JSON.stringify(params)}` : ""}`
  const localizeViewFor = createLocalizeViewFor(translator)
  const viewLocaleOf = createViewLocaleOf(translator)

  it("titles the view in the language the profile names, the summary alike", async () => {
    for (const language of ["de", "en"]) {
      const { t, title } = await localizeViewFor(storeWith(language), CTX)
      expect(title("view.title")).toBe(`${language}:view.title`)
      expect(title("view.title", { n: 2 })).toBe(`${language}:view.title:{"n":2}`)
      expect(t("summary")).toBe(`${language}:summary`)
    }
  })

  it("sets no title for system, no saved language or one without a catalog; summaries in English", async () => {
    for (const language of ["system", undefined, "fr"]) {
      const { t, title } = await localizeViewFor(storeWith(language), CTX)
      expect(title("view.title")).toBeUndefined()
      expect(t("summary")).toBe("en:summary")
      expect(viewLocaleOf(language).title("view.title")).toBeUndefined()
    }
  })

  it("no store, no caller or a store outage reads as system: no title", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const broken: ProfileSource = { get: () => Promise.reject(new Error("pg down")) }
    for (const view of [
      await localizeViewFor(undefined, CTX),
      await localizeViewFor(storeWith("de")),
      await localizeViewFor(broken, CTX),
    ]) {
      expect(view.title("view.title")).toBeUndefined()
      expect(view.t("summary")).toBe("en:summary")
    }
    warn.mockRestore()
  })

  it("a language already read titles the same way", () => {
    expect(viewLocaleOf("de").title("view.title")).toBe("de:view.title")
    expect(viewLocaleOf("en").t("summary")).toBe("en:summary")
  })
})
