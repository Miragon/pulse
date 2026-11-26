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
 * The page error vocabulary: a page maps its transport's failures to one of eight codes once, and
 * the kit words each in English and German, a place or a name passed in where a transport has
 * its own (the claude.ai template passes its connector's name and where Settings keeps it).
 */

const { en, de } = UI_MESSAGES
const CLAUDE_AI = {
  en: "in claude.ai, in Settings under Connectors",
  de: "in claude.ai in den Einstellungen unter Connectors",
} as const

describe("describePageError", () => {
  it("knows the eight codes, in the order of the type", () => {
    expect(PAGE_ERROR_CODES).toEqual([
      "needs_reauth",
      "not_connected",
      "selection_required",
      "not_declared",
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

  it("tells a missing connection, one to choose and a page that declares none apart, each with its own way out", () => {
    const words = (code: PageErrorCode, messages = en) =>
      describePageError({ code }, { messages, connector: "Pulse", place: CLAUDE_AI.en })
    // The viewer sets the connection up where they manage it.
    expect(words("not_connected").hint).toBe(
      "Set up Pulse in claude.ai, in Settings under Connectors, then try again.",
    )
    // The viewer has the connection, and chooses which one the page uses when asked.
    expect(words("selection_required")).toEqual({
      title: "This page waits for you to choose its connection to Pulse",
      hint: "Choose the connection to Pulse the page should use when you're asked, then try again.",
    })
    expect(words("selection_required", de)).toEqual({
      title: "Diese Seite wartet darauf, dass du ihre Verbindung zu Pulse wählst",
      hint: "Wähl die Verbindung zu Pulse, die die Seite nutzen soll, wenn du gefragt wirst, und versuch es dann noch mal.",
    })
    // Only whoever published the page can declare its connection: no place of the viewer's, no
    // retry.
    expect(words("not_declared")).toEqual({
      title: "This page isn't set up to use Pulse",
      hint: "Only whoever published the page can set up its connection to Pulse. Ask them.",
      permanent: true,
    })
    expect(words("not_declared", de)).toEqual({
      title: "Diese Seite ist nicht dafür eingerichtet, Pulse zu nutzen",
      hint: "Nur die Person, die die Seite veröffentlicht hat, kann ihre Verbindung zu Pulse einrichten. Frag sie.",
      permanent: true,
    })
    for (const code of ["selection_required", "not_declared"] as const) {
      for (const messages of [en, de]) {
        expect(words(code, messages).hint, code).not.toContain("Connectors")
      }
    }
  })

  it("sends the reader to whoever runs the connection that failed, never to a fixed server", () => {
    expect(
      describePageError({ code: "unavailable" }, { messages: en, connector: "Acme CRM" }).hint,
    ).toBe("Try again in a moment. If it keeps failing, ask whoever runs Acme CRM.")
    expect(
      describePageError({ code: "tool_error" }, { messages: de, connector: "Acme CRM" }).hint,
    ).toBe("Versuch es noch mal. Klappt es wieder nicht, frag die Person, die Acme CRM betreibt.")
    for (const messages of [en, de]) {
      for (const code of PAGE_ERROR_CODES) {
        const { title, hint } = describePageError({ code }, { messages, connector: "Acme CRM" })
        expect(`${title} ${hint}`, code).not.toContain("Pulse")
      }
    }
  })

  it("marks only a refusal no retry changes as permanent", () => {
    const permanent = PAGE_ERROR_CODES.filter(
      (code) => describePageError({ code }, { messages: en }).permanent === true,
    )
    expect(permanent).toEqual(["not_declared", "not_allowed"])
    // Each one's hint names the way out, never "try again".
    for (const code of permanent) {
      expect(describePageError({ code }, { messages: en }).hint, code).not.toMatch(/try/i)
      expect(describePageError({ code }, { messages: de }).hint, code).not.toMatch(/versuch/i)
    }
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
