import { describePageError, PAGE_ERROR_CODES, resolveUiMessages } from "@miragon/pulse-ui"
import { describe, expect, it } from "vitest"
import { EngineError } from "../src/engine/connector.ts"
import { CLAUDE_PLACE, describeEngineError } from "../src/engine/errors.ts"
import { CONNECTOR_NAME } from "../src/page.config.ts"

const REFUSALS = PAGE_ERROR_CODES.filter((code) => code !== "tool_error")

describe("the words of a failed call", () => {
  it.each(REFUSALS)(
    "%s: the kit's page error words with the connector's name and claude.ai's place, in English and German, the raw text as details",
    (code) => {
      const error = new EngineError(code, "engine_process_stats", "raw runtime text")
      for (const [locale, language] of [
        ["en", "en"],
        ["de-DE", "de"],
      ] as const) {
        expect(describeEngineError(error, locale)).toEqual(
          describePageError(
            { code, detail: "raw runtime text" },
            {
              messages: resolveUiMessages(language),
              connector: CONNECTOR_NAME,
              place: CLAUDE_PLACE[language],
            },
          ),
        )
      }
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
