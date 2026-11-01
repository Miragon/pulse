import { describe, expect, it } from "vitest"
import {
  formatCount,
  resolveUiLocale,
  resolveUiMessages,
  TOOLKIT_LOCALES,
  UI_MESSAGES,
  type UiMessages,
} from "./ui-messages.js"

/**
 * The catalog guard: every kit string follows the house copy rules in
 * BOTH locales (brand-tone: no dash as a connector, one "…" character, no
 * framework jargon; German with du, AI not KI, "CIB seven"; English in
 * sentence case), and the German catalog is a real translation, not a copy.
 */

/** Sample arguments for the function-valued messages. */
const SAMPLES: Record<string, unknown[]> = {
  showing: [{ shown: "8", total: "42", noun: "tasks" }],
}

/** Every message of a catalog as `[path, rendered text]`. */
function flatten(messages: UiMessages): [string, string][] {
  const out: [string, string][] = []
  for (const [section, entries] of Object.entries(messages)) {
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const text =
        typeof value === "function"
          ? (value as (...args: unknown[]) => string)(...(SAMPLES[key] ?? []))
          : value
      out.push([`${section}.${key}`, String(text)])
    }
  }
  return out
}

const shape = (messages: UiMessages) =>
  Object.fromEntries(
    Object.entries(messages).map(([section, entries]) => [
      section,
      Object.fromEntries(
        Object.entries(entries as Record<string, unknown>).map(([k, v]) => [k, typeof v]),
      ),
    ]),
  )

describe("kit catalogs", () => {
  it("ship en and de with the identical section/key shape and value kinds", () => {
    expect(TOOLKIT_LOCALES).toEqual(["en", "de"])
    expect(shape(UI_MESSAGES.de)).toEqual(shape(UI_MESSAGES.en))
  })

  for (const locale of TOOLKIT_LOCALES) {
    describe(`${locale} copy rules`, () => {
      const entries = flatten(UI_MESSAGES[locale])

      it("has no empty or padded message", () => {
        for (const [path, text] of entries) {
          expect(text.trim().length, path).toBeGreaterThan(0)
          expect(text, path).toBe(text.trim())
        }
      })

      it("uses no dash as a connector (A2) and the ellipsis character, never three dots", () => {
        for (const [path, text] of entries) {
          expect(text, path).not.toMatch(/—| – | - /)
          expect(text, path).not.toContain("...")
        }
      })

      it("speaks no framework jargon to users (no 'pipeline')", () => {
        for (const [path, text] of entries) expect(text, path).not.toMatch(/pipeline/i)
      })

      it("writes the brand spellings (AI, CIB seven)", () => {
        for (const [path, text] of entries) {
          expect(text, path).not.toMatch(/\bKI\b/)
          expect(text, path).not.toMatch(/CIB Seven|CIB SEVEN/)
        }
      })
    })
  }

  it("de addresses the reader with du, never Sie/Ihnen/Ihr or an impersonal 'man'", () => {
    for (const [path, text] of flatten(UI_MESSAGES.de)) {
      expect(text, path).not.toMatch(/\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/)
      expect(text, path).not.toMatch(/\bman\b/)
    }
  })

  it("en is in sentence case: no two capitalised words in a row within a sentence", () => {
    const capitalised = (word: string) => /^[A-Z][a-z]/.test(word)
    for (const [path, text] of flatten(UI_MESSAGES.en)) {
      const words = text.split(/\s+/)
      for (let i = 1; i < words.length; i++) {
        const prev = words[i - 1] ?? ""
        const word = words[i] ?? ""
        const titleCasePair = capitalised(prev) && !/[.!?:]$/.test(prev) && capitalised(word)
        expect(titleCasePair, `${path}: "${prev} ${word}"`).toBe(false)
      }
    }
  })

  it("de is a translation: only loanwords may equal the English text", () => {
    const en = new Map(flatten(UI_MESSAGES.en))
    const identical = flatten(UI_MESSAGES.de)
      .filter(([path, text]) => en.get(path) === text)
      .map(([, text]) => text)
    expect([...new Set(identical)].sort()).toEqual(["Details", "Live"])
  })

  it("renders counts and names into the parametrised messages", () => {
    const { en, de } = UI_MESSAGES
    expect(en.listFooter.showing({ shown: "8", total: "42", noun: "tasks" })).toBe(
      "Showing 8 of 42 tasks",
    )
    expect(de.listFooter.showing({ shown: "8", total: "42", noun: "Aufgaben" })).toBe(
      "Zeigt 8 von 42 Aufgaben",
    )
    // An empty noun leaves no trailing blank.
    expect(en.listFooter.showing({ shown: "1", total: "2", noun: "" })).toBe("Showing 1 of 2")
    expect(de.listFooter.showing({ shown: "1", total: "2", noun: "" })).toBe("Zeigt 1 von 2")
  })
})

describe("resolveUiLocale", () => {
  it("maps a BCP 47 tag onto its shipped primary language", () => {
    expect(resolveUiLocale("de")).toBe("de")
    expect(resolveUiLocale("de-DE")).toBe("de")
    expect(resolveUiLocale("de_AT")).toBe("de")
    expect(resolveUiLocale(" DE-ch ")).toBe("de")
    expect(resolveUiLocale("en-US")).toBe("en")
  })

  it("falls back to English for any other or missing locale", () => {
    expect(resolveUiLocale("fr-FR")).toBe("en")
    expect(resolveUiLocale("")).toBe("en")
    expect(resolveUiLocale(undefined)).toBe("en")
    expect(resolveUiLocale("deu")).toBe("en")
  })
})

describe("resolveUiMessages", () => {
  it("returns the shipped catalog itself without an override (stable identity)", () => {
    expect(resolveUiMessages("de-DE")).toBe(UI_MESSAGES.de)
    expect(resolveUiMessages("es")).toBe(UI_MESSAGES.en)
  })

  it("merges an override per section and keeps every other string", () => {
    const merged = resolveUiMessages("de", {
      listFooter: { loadMore: "Weitere laden" },
      filterBar: { searchLabel: "Suchen" },
    })
    expect(merged.listFooter.loadMore).toBe("Weitere laden")
    expect(merged.listFooter.loadingMore).toBe(UI_MESSAGES.de.listFooter.loadingMore)
    expect(merged.filterBar.searchLabel).toBe("Suchen")
    expect(merged.filterBar.chipsLabel).toBe(UI_MESSAGES.de.filterBar.chipsLabel)
    for (const section of ["common", "pills"] as const) {
      expect(merged[section]).toEqual(UI_MESSAGES.de[section])
    }
  })
})

describe("formatCount", () => {
  it("groups digits per locale", () => {
    expect(formatCount(1234567, "en")).toBe("1,234,567")
    expect(formatCount(1234567, "de-DE")).toBe("1.234.567")
    expect(formatCount(7, "de")).toBe("7")
  })

  it("falls back to English for an invalid locale tag instead of throwing", () => {
    expect(formatCount(1234, "not a locale!")).toBe("1,234")
  })
})
