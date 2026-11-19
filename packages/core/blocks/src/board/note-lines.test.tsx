// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { useNoteLines } from "./problem-words.js"

afterEach(cleanup)

const NOTES = [
  { path: "layout", code: "ignoredKey" },
  { path: "rows[1].row[0]", code: "diagramTooLong", values: { title: "Orders", engine: "prod" } },
] as const

function linesIn(locale: string): string[] {
  const { result } = renderHook(() => useNoteLines(), {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <LocaleProvider locale={locale}>{children}</LocaleProvider>
    ),
  })
  return NOTES.map((note) => result.current(note))
}

describe("a board's notes in the nearest locale", () => {
  it("are one line each, the file's after its path, the diagram's after its tile", () => {
    expect(linesIn("en")).toEqual([
      "layout is not a key this version of Pulse knows; Pulse shows the board without it",
      '"Orders" on prod may show no count on a collapsed subprocess for what runs inside it, because the diagram is longer than Pulse reads',
    ])
    expect(linesIn("de-DE")).toEqual([
      "layout ist kein Schlüssel, den diese Version von Pulse kennt; Pulse zeigt das Board ohne ihn",
      "„Orders“ auf prod zeigt an einem zugeklappten Teilprozess womöglich keine Zahl für das, was darin läuft, weil das Diagramm länger ist, als Pulse liest",
    ])
  })
})
