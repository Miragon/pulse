import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { RENDER_CASES } from "./render-cases.js"

/**
 * The SSR render suite over `render-cases.tsx` (no DOM): every case renders without throwing,
 * to non-empty markup, and keeps its marker where one is set. `i18n-coverage.test.tsx` reads
 * the same cases for English leaks only, so a component that renders empty or drops its
 * children fails here.
 */
const named = RENDER_CASES.map((renderCase) => [renderCase.name, renderCase] as const)
const marked = RENDER_CASES.flatMap((renderCase) =>
  renderCase.marker ? [[renderCase.name, renderCase.marker, renderCase] as const] : [],
)

describe("RENDER_CASES (SSR render suite)", () => {
  it("has one case per name: a duplicate would mask a missing component", () => {
    expect(new Set(RENDER_CASES.map((renderCase) => renderCase.name)).size).toBe(
      RENDER_CASES.length,
    )
  })

  it("sets a marker on all but one case (Skeleton renders no text), so the check below runs", () => {
    expect(marked.length).toBeGreaterThanOrEqual(25)
  })

  it.each(named)("%s SSR-renders to non-empty markup", (name, renderCase) => {
    expect(renderToStaticMarkup(renderCase.render()).length, name).toBeGreaterThan(0)
  })

  it.each(marked)("%s keeps its marker %s in the markup", (name, marker, renderCase) => {
    expect(renderToStaticMarkup(renderCase.render()), name).toContain(marker)
  })
})
