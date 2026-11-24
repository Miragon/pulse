import { describe, expect, it } from "vitest"
import {
  BARE_PAUSE_RULE_EN,
  catalogTextFindings,
  glossaryFindings,
  PRODUCT_GLOSSARY,
} from "../testing/index.js"
import { describePageError, PAGE_ERROR_CODES, type PageErrorCode } from "./page-errors.js"
import { resolveUiMessages, UI_MESSAGES } from "./ui-messages.js"

/**
 * The page error vocabulary: a page maps its transport's failures to one of six codes once, and
 * the kit words each in English and German, a place or a name passed in where a transport has
 * its own (the claude.ai template passes its connector's name and where Settings keeps it).
 */

const { en, de } = UI_MESSAGES
const CLAUDE_AI = {
  en: "in claude.ai, in Settings under Connectors",
  de: "in claude.ai in den Einstellungen unter Connectors",
} as const

describe("describePageError", () => {
  it("knows the six codes, in the order of the type", () => {
    expect(PAGE_ERROR_CODES).toEqual([
      "needs_reauth",
      "not_connected",
      "not_allowed",
      "approval_required",
      "unavailable",
      "tool_error",
    ])
  })

  it("says what happened and what you can do, naming Pulse unless the page names its own", () => {
    expect(describePageError({ code: "needs_reauth" }, { messages: en })).toEqual({
      title: "Your sign-in to Pulse has expired",
      hint: "Reconnect to Pulse, then try again.",
    })
    expect(
      describePageError(
        { code: "needs_reauth", detail: "401 from the connector" },
        { messages: en, connector: "Pulse prod", place: CLAUDE_AI.en },
      ),
    ).toEqual({
      title: "Your sign-in to Pulse prod has expired",
      hint: "Reconnect to Pulse prod in claude.ai, in Settings under Connectors, then try again.",
      details: "401 from the connector",
    })
    expect(
      describePageError(
        { code: "not_connected" },
        { messages: de, connector: "Pulse", place: CLAUDE_AI.de },
      ),
    ).toEqual({
      title: "Diese Seite ist nicht mit Pulse verbunden",
      hint: "Richte Pulse in claude.ai in den Einstellungen unter Connectors ein und versuch es dann noch mal.",
    })
    expect(describePageError({ code: "needs_reauth" }, { messages: de }).hint).toBe(
      "Verbinde Pulse neu und versuch es dann noch mal.",
    )
  })

  it("marks only a refusal no retry changes as permanent", () => {
    const permanent = PAGE_ERROR_CODES.filter(
      (code) => describePageError({ code }, { messages: en }).permanent === true,
    )
    expect(permanent).toEqual(["not_allowed"])
    // Its hint names the way out, never "try again".
    expect(describePageError({ code: "not_allowed" }, { messages: en }).hint).not.toMatch(/try/i)
    expect(describePageError({ code: "not_allowed" }, { messages: de }).hint).not.toMatch(
      /versuch/i,
    )
  })

  it("puts the raw text only under Details, trimmed, and none for an empty one", () => {
    const words = describePageError(
      { code: "tool_error", detail: "  Engine answered 503\n" },
      { messages: en },
    )
    expect(words.details).toBe("Engine answered 503")
    expect(words.title).not.toContain("503")
    expect(
      describePageError({ code: "tool_error", detail: " " }, { messages: en }),
    ).not.toHaveProperty("details")
    expect(
      describePageError({ code: "tool_error", detail: null }, { messages: en }),
    ).not.toHaveProperty("details")
  })

  it("words a code an untyped transport invents as the server's error, never throws", () => {
    const unknown = { code: "teapot" as PageErrorCode }
    expect(describePageError(unknown, { messages: en })).toEqual(
      describePageError({ code: "tool_error" }, { messages: en }),
    )
  })

  it("follows the catalog it is handed, an override included", () => {
    const messages = resolveUiMessages("de", {
      pageError: { unavailable: ({ connector }) => `${connector} schläft` },
    })
    expect(describePageError({ code: "unavailable" }, { messages }).title).toBe("Pulse schläft")
    expect(describePageError({ code: "unavailable" }, { messages }).hint).toBe(
      de.pageError.unavailableHint({ connector: "Pulse" }),
    )
  })

  it("has a different title and hint for every code, in both languages", () => {
    for (const messages of [en, de]) {
      const words = PAGE_ERROR_CODES.map((code) => describePageError({ code }, { messages }))
      expect(new Set(words.map((each) => each.title)).size).toBe(PAGE_ERROR_CODES.length)
      expect(new Set(words.map((each) => each.hint)).size).toBe(PAGE_ERROR_CODES.length)
    }
  })

  it.each(["en", "de"] as const)(
    "follows the voice rules and the product's words with a place and without (%s)",
    (language) => {
      const messages = UI_MESSAGES[language]
      for (const place of [CLAUDE_AI[language], undefined]) {
        const catalog = Object.fromEntries(
          PAGE_ERROR_CODES.map((code) => [code, describePageError({ code }, { messages, place })]),
        )
        expect(catalogTextFindings(catalog, { language })).toEqual([])
        const rules =
          language === "en" ? [...PRODUCT_GLOSSARY.en, BARE_PAUSE_RULE_EN] : PRODUCT_GLOSSARY.de
        expect(glossaryFindings(catalog, rules)).toEqual([])
      }
    },
  )
})
