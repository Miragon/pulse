import { getFormatLocale } from "@miragon/pulse-ui/format"
import { describe, expect, test } from "vitest"
import { CountLabels } from "../../src/webview/format/count-labels.js"
import { TimeLabels } from "../../src/webview/format/time-labels.js"

describe("the webview's formats", () => {
  test("speak English with a 24-hour clock, whatever the system speaks", () => {
    const at = new Date(2026, 9, 21, 16, 41, 9)
    expect(TimeLabels.clock(at.toISOString(), at)).toBe("16:41")
    expect(TimeLabels.asOf(at.toISOString(), at)).toBe("16:41:09")
    expect(TimeLabels.asOf(at.toISOString(), new Date(2026, 9, 22, 9))).toBe("Oct 21, 16:41:09")
    expect(getFormatLocale()).toEqual({ language: "en", locale: "en-u-hc-h23" })
  })

  test("say how long ago in the largest whole unit, under a minute in words", () => {
    const now = new Date("2026-10-21T12:00:00Z")
    expect(TimeLabels.relative("2026-10-21T11:55:00Z", now)).toBe("5m ago")
    expect(TimeLabels.relative("2026-10-21T09:00:00Z", now)).toBe("3h ago")
    expect(TimeLabels.relative("2026-10-21T11:59:40Z", now)).toBe("just now")
    expect(TimeLabels.relative("2026-10-21T12:00:20Z", now)).toBe("in under a minute")
  })

  test("count exactly, compactly and as a lower bound, in one spelling", () => {
    expect(CountLabels.exact(1234)).toBe("1,234")
    expect(CountLabels.exact(2000, true)).toBe("≥ 2,000")
    expect(CountLabels.compact(999)).toBe("999")
    expect(CountLabels.compact(12_345)).toBe("12.3k")
    expect(CountLabels.compact(10_000, true)).toBe("10k+")
    expect(CountLabels.plural(1, "engine")).toBe("1 engine")
    expect(CountLabels.plural(1234, "engine")).toBe("1,234 engines")
  })
})
