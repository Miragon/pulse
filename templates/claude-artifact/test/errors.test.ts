import { describe, expect, it } from "vitest"
import { CONNECTOR_NAME } from "../src/engine/claude-connector.ts"
import { ENGINE_ERROR_CODES, EngineError } from "../src/engine/connector.ts"
import { describeEngineError } from "../src/engine/errors.ts"

describe("the words of a failed call", () => {
  it.each(ENGINE_ERROR_CODES.filter((code) => code !== "tool_error"))(
    "%s: what happened and what to do, in English and German, the raw text as details",
    (code) => {
      const error = new EngineError(code, "engine_status", "raw runtime text")
      for (const locale of ["en", "de-DE"]) {
        const words = describeEngineError(error, locale)
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
    "names the connector the page calls where the viewer has to find it in claude.ai (%s)",
    (locale) => {
      for (const code of ["needs_reauth", "not_connected", "approval_required"] as const) {
        const { hint } = describeEngineError(new EngineError(code, "engine_status", "x"), locale)
        expect(hint, code).toContain(CONNECTOR_NAME)
        expect(hint, code).toContain("claude.ai")
      }
      for (const code of ENGINE_ERROR_CODES.filter((code) => code !== "tool_error")) {
        const { hint } = describeEngineError(new EngineError(code, "engine_status", "x"), locale)
        expect(hint, code).not.toMatch(/[{}]/)
      }
    },
  )

  it("never offers Try again for a call the page may not make", () => {
    expect(
      describeEngineError(new EngineError("not_allowed", "engine_status", "x"), "en").retry,
    ).toBe(false)
    expect(
      describeEngineError(new EngineError("unavailable", "engine_status", "x"), "en").retry,
    ).toBe(true)
  })

  it.each([
    ["en", /try again/i, /reload/i],
    ["de", /noch mal/i, /neu laden|lade die seite/i],
  ] as const)(
    "says to try again exactly where it offers Try again, never to reload instead (%s)",
    (locale, again, reload) => {
      for (const code of ENGINE_ERROR_CODES.filter((code) => code !== "tool_error")) {
        const words = describeEngineError(new EngineError(code, "engine_status", "x"), locale)
        expect(again.test(words.hint), code).toBe(words.retry)
        expect(reload.test(words.hint), code).toBe(false)
      }
    },
  )

  it("classifies the server's errors by the kit's rules, the raw text only as details", () => {
    const unreachable = describeEngineError(
      new EngineError("tool_error", "engine_status", "engine prod-a unreachable (ECONNREFUSED)"),
      "en",
    )
    expect(unreachable.title).toContain("prod-a")
    expect(unreachable.title).not.toContain("ECONNREFUSED")
    expect(unreachable.details).toBe("engine prod-a unreachable (ECONNREFUSED)")
    expect(unreachable.retry).toBe(true)
  })

  it("words the server's refusals no retry changes in the page's own hints", () => {
    const invalid = describeEngineError(
      new EngineError("tool_error", "engine_status", "Input validation error: unknown key foo"),
      "en",
    )
    expect(invalid.retry).toBe(false)
    expect(invalid.hint).toContain("published the page")
    expect(invalid.hint).not.toMatch(/chat|start page/i)
  })
})
