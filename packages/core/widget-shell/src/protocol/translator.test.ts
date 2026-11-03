import { describe, expect, it } from "vitest"
import { createTranslator } from "./translator.js"

const catalogs = {
  en: {
    greeting: ({ name }: Record<string, unknown>) => `Hello, ${String(name)}`,
    plain: "A plain string",
  },
  de: {
    greeting: ({ name }: Record<string, unknown>) => `Hallo, ${String(name)}`,
  },
}

describe("createTranslator", () => {
  it("resolves a message in the requested locale", () => {
    expect(createTranslator(catalogs)("de", "greeting", { name: "Ada" })).toBe("Hallo, Ada")
  })

  it("returns a string message as it is", () => {
    expect(createTranslator(catalogs)("en", "plain")).toBe("A plain string")
  })

  it("falls back to English when the requested locale lacks the key", () => {
    expect(createTranslator(catalogs)("de", "plain")).toBe("A plain string")
  })

  it("falls back to English when the requested locale has no catalog", () => {
    expect(createTranslator(catalogs)("fr", "greeting", { name: "Ada" })).toBe("Hello, Ada")
  })

  it("returns the key itself when no catalog has the message", () => {
    expect(createTranslator(catalogs)("de", "does.not.exist")).toBe("does.not.exist")
    expect(createTranslator({ de: {} })("de", "only.key")).toBe("only.key")
  })

  it("hands a function message an empty params object when none is given", () => {
    const t = createTranslator({ en: { greeting: ({ name }) => `Hi ${String(name)}` } })
    expect(t("en", "greeting")).toBe("Hi undefined")
  })

  it("interpolates {name} placeholders in string messages", () => {
    const t = createTranslator({ en: { hi: "Hi {name}, {n} new" } })
    expect(t("en", "hi", { name: "Ada", n: 3 })).toBe("Hi Ada, 3 new")
  })

  it("leaves unknown placeholders untouched", () => {
    const t = createTranslator({ en: { a: "Hello {missing}" } })
    expect(t("en", "a", { other: 1 })).toBe("Hello {missing}")
    expect(t("en", "a")).toBe("Hello {missing}")
  })
})
