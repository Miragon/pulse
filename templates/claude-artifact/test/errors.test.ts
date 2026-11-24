import { describePageError, PAGE_ERROR_CODES, resolveUiMessages } from "@miragon/pulse-ui"
import { describe, expect, it } from "vitest"
import { CONNECTOR_NAME } from "../src/engine/claude-connector.ts"
import { ENGINE_ERROR_CODES, EngineError } from "../src/engine/connector.ts"
import { CLAUDE_PLACE, describeEngineError } from "../src/engine/errors.ts"

const REFUSALS = ENGINE_ERROR_CODES.filter((code) => code !== "tool_error")

describe("the words of a failed call", () => {
  it("has the codes of pulse-ui's page errors, in their order", () => {
    expect(ENGINE_ERROR_CODES).toEqual(PAGE_ERROR_CODES)
  })

  it.each(REFUSALS)(
    "%s: the kit's words of what happened and what to do, in English and German, the raw text as details",
    (code) => {
      const error = new EngineError(code, "engine_process_stats", "raw runtime text")
      for (const locale of ["en", "de-DE"]) {
        const words = describeEngineError(error, locale)
        expect(words).toEqual(
          describePageError(error, {
            messages: resolveUiMessages(locale),
            connector: CONNECTOR_NAME,
            place: CLAUDE_PLACE[locale === "en" ? "en" : "de"],
          }),
        )
        expect(words.title).not.toBe("")
        expect(words.hint).not.toBe("")
        expect(words.details).toBe("raw runtime text")
      }
      expect(describeEngineError(error, "en").title).not.toBe(
        describeEngineError(error, "de").title,
      )
    },
  )

  it.each(["en", "de"])(
    "names the connector, and claude.ai where the viewer has to find it there (%s)",
    (locale) => {
      for (const code of ["needs_reauth", "not_connected"] as const) {
        const { hint } = describeEngineError(
          new EngineError(code, "engine_process_stats", "x"),
          locale,
        )
        expect(hint, code).toContain(CONNECTOR_NAME)
        expect(hint, code).toContain("claude.ai")
      }
      const approval = describeEngineError(
        new EngineError("approval_required", "engine_process_stats", "x"),
        locale,
      )
      expect(approval.hint).toContain(CONNECTOR_NAME)
    },
  )

  it("never offers Try again for a call the page may not make", () => {
    const call = (code: (typeof REFUSALS)[number]) =>
      describeEngineError(new EngineError(code, "engine_process_stats", "x"), "en")
    expect(call("not_allowed").permanent).toBe(true)
    expect(call("unavailable").permanent).toBeUndefined()
  })

  it.each([
    ["en", /try again/i, /reload/i],
    ["de", /noch mal/i, /neu laden|lade die seite/i],
  ] as const)(
    "says to try again exactly where it offers Try again, never to reload instead (%s)",
    (locale, again, reload) => {
      for (const code of REFUSALS) {
        const words = describeEngineError(
          new EngineError(code, "engine_process_stats", "x"),
          locale,
        )
        expect(again.test(words.hint ?? ""), code).toBe(words.permanent !== true)
        expect(reload.test(words.hint ?? ""), code).toBe(false)
      }
    },
  )

  it("classifies the server's errors by the kit's rules, the raw text only as details", () => {
    const unreachable = describeEngineError(
      new EngineError(
        "tool_error",
        "engine_process_stats",
        "engine prod-a unreachable (ECONNREFUSED)",
      ),
      "en",
    )
    expect(unreachable.title).toContain("prod-a")
    expect(unreachable.title).not.toContain("ECONNREFUSED")
    expect(unreachable.details).toBe("engine prod-a unreachable (ECONNREFUSED)")
    expect(unreachable.permanent).toBeUndefined()
  })

  it("words the server's refusals no retry changes in the page's own hints", () => {
    const invalid = describeEngineError(
      new EngineError(
        "tool_error",
        "engine_process_stats",
        "Input validation error: unknown key foo",
      ),
      "en",
    )
    expect(invalid.permanent).toBe(true)
    expect(invalid.hint).toContain("published the page")
    expect(invalid.hint).not.toMatch(/chat|start page/i)
  })
})
