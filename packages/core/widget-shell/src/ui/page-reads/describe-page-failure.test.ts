import { describe, expect, it } from "vitest"
import { describePageError, PAGE_ERROR_CODES, resolveUiMessages } from "@miragon/pulse-ui"
import { ToolResultError } from "../../protocol/tool-result.js"
import { ARTIFACT_PAGE_HINTS } from "../claude-artifact/artifact-hints.js"
import { describeError } from "../describe-error.js"
import { PAGE_HINTS, type PageHints } from "../page-hints.js"
import { WebApiError } from "../web-caller.js"
import { describePageFailure } from "./describe-page-failure.js"
import { PageCallError } from "./page-call-error.js"

/**
 * A page's failed read in words: the transport's refusals in the kit's page error words with the
 * connection's name and its place, the server's errors by the kit's rules with the page's hints,
 * the raw text only under "Details", `permanent` where Try again cannot help.
 */

const PLACE = { en: "in the test bench, under Connections", de: "im Prüfstand unter Verbindungen" }

/** A page's hints with the place its viewer manages its connection. */
const HINTS: PageHints = {
  en: { ...PAGE_HINTS.en, connectionPlace: PLACE.en },
  de: { ...PAGE_HINTS.de, connectionPlace: PLACE.de },
}

const REFUSALS = PAGE_ERROR_CODES.filter((code) => code !== "tool_error")

describe("describePageFailure", () => {
  it.each(REFUSALS)(
    "%s: the kit's page error words with the connection's name and place, in English and German",
    (code) => {
      const error = new PageCallError(code, "raw runtime text", {
        tool: "engine_process_stats",
        connector: "Acme CRM",
      })
      for (const [locale, language] of [
        ["en", "en"],
        ["de-DE", "de"],
      ] as const) {
        expect(describePageFailure(error, locale, { pageHints: HINTS })).toEqual(
          describePageError(
            { code, detail: "raw runtime text" },
            {
              messages: resolveUiMessages(language),
              connector: "Acme CRM",
              place: PLACE[language],
            },
          ),
        )
      }
    },
  )

  it("names the connection and its place where the viewer has to act there", () => {
    for (const code of ["needs_reauth", "not_connected"] as const) {
      const { hint } = describePageFailure(
        new PageCallError(code, "x", { connector: "Shop" }),
        "en",
        {
          pageHints: HINTS,
        },
      )
      expect(hint, code).toContain("Shop")
      expect(hint, code).toContain(PLACE.en)
    }
    const without = describePageFailure(new PageCallError("needs_reauth", "x"), "en")
    expect(without.hint).toContain("Pulse")
    expect(without.hint).not.toContain(PLACE.en)
  })

  it("sends the reader to whoever runs the connection that does not answer, in English and German", () => {
    const silent = new PageCallError("unavailable", "x", { connector: "Acme CRM" })
    for (const locale of ["en", "de"]) {
      const { title, hint } = describePageFailure(silent, locale, { pageHints: HINTS })
      expect(title, locale).toContain("Acme CRM")
      expect(hint, locale).toContain("Acme CRM")
      expect(`${title} ${hint}`, locale).not.toContain("Pulse")
    }
  })

  it("classifies the server's errors by the kit's rules, the raw text only as details", () => {
    const text = "engine prod-a unreachable (ECONNREFUSED)"
    for (const error of [
      new ToolResultError({ isError: true, content: [{ type: "text", text }] }),
      new PageCallError("tool_error", text, { connector: "Pulse" }),
    ]) {
      const words = describePageFailure(error, "en", { pageHints: HINTS })
      expect(words.title).toContain("prod-a")
      expect(words.title).not.toContain("ECONNREFUSED")
      expect(words.details).toBe(text)
      expect(words.permanent).toBeUndefined()
    }
  })

  it("words a refusal no retry changes in the page's hints, and says it is permanent", () => {
    const invalid = describePageFailure(
      new ToolResultError({
        isError: true,
        content: [{ type: "text", text: "Input validation error: unknown key foo" }],
      }),
      "en",
      { pageHints: HINTS },
    )
    expect(invalid).toEqual({
      title: describeError("Input validation error: unknown key foo", "en").title,
      hint: PAGE_HINTS.en.invalidArguments,
      details: "Input validation error: unknown key foo",
      permanent: true,
    })
    expect(describePageFailure(new PageCallError("not_allowed", "x"), "en").permanent).toBe(true)
  })

  it("knows the server's strict-input refusal as claude.ai's artifact runtime hands it on", () => {
    // The probe of 2026-11-25: the server's text without the SDK's lead.
    const text = 'Invalid arguments for tool engine_activity_counts: Unknown key "n".'
    const refused = new ToolResultError({ isError: true, content: [{ type: "text", text }] })
    expect(describePageFailure(refused, "en", { pageHints: ARTIFACT_PAGE_HINTS })).toEqual({
      title: "The server refused this request",
      hint: "You'll find the reason under Details. Whoever published the page can fix the call.",
      details: text,
      permanent: true,
    })
    expect(describePageFailure(refused, "de", { pageHints: ARTIFACT_PAGE_HINTS }).hint).toBe(
      ARTIFACT_PAGE_HINTS.de.invalidArguments,
    )
  })

  it("follows the host: a chat's words in a chat, a page's (the default) elsewhere", () => {
    const error = new Error("Something odd happened")
    expect(describePageFailure(error, "de", { pageHints: HINTS }).hint).toBe(PAGE_HINTS.de.unknown)
    expect(describePageFailure(error, "de", { followUp: "chat", pageHints: HINTS }).hint).toBe(
      describeError(error, "de").hint,
    )
  })

  it("words any other failure through describeError, the web app's signed-out session included", () => {
    const signedOut = new WebApiError(401, { code: "signed_out", message: "No session." })
    expect(describePageFailure(signedOut, "en")).toEqual({
      title: describeError(signedOut, "en").title,
      hint: describeError(signedOut, "en", { followUp: "none" }).hint,
      details: "No session.",
      permanent: true,
    })
    const nothing = describePageFailure(undefined, "en")
    expect(nothing.details).toBeUndefined()
    expect(nothing.title).toBe(describeError(undefined, "en").title)
  })
})
