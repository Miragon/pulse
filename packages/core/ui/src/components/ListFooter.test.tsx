import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "../locale/locale-provider.js"
import { attribute, openingTags } from "../render-scan.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { ListFooter, type ListFooterProps } from "./ListFooter.js"

const noop = (): void => {}

function render(props: Partial<ListFooterProps> = {}, locale = "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <ListFooter shown={8} total={42} hasMore onLoadMore={noop} noun="tasks" {...props} />
    </LocaleProvider>,
  )
}

/** The text of the live region (the one `role="status"` element). */
function statusText(html: string): string | undefined {
  const match = /<p role="status"[^>]*>([\s\S]*?)<\/p>/.exec(html)
  return match?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** The class of the footer's root (`sr-only` while nothing is visible). */
function footerClass(html: string): string | undefined {
  return attribute(openingTags(html, "div")[0] ?? "", "class")
}

describe("ListFooter: an honest count in a polite live region", () => {
  it("puts the count in ONE status region and Load more outside it", () => {
    const html = render()
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(statusText(html)).toBe("Showing 8 of 42 tasks")
    const [button] = openingTags(html, "button")
    expect(attribute(button ?? "", "type")).toBe("button")
    expect(attribute(button ?? "", "class")).toContain(FOCUS_RING)
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("</p>"))
    expect(html).toContain("text-small")
    expect(html).not.toContain("text-xs")
  })

  it("says Updating… next to the count while a same-filter refetch runs", () => {
    expect(statusText(render({ refreshing: true }))).toBe("Showing 8 of 42 tasks Updating…")
    expect(statusText(render({ refreshing: true }, "de"))).toBe(
      "Zeigt 8 von 42 tasks Wird aktualisiert…",
    )
  })

  it("hides the count and Load more while the rows are the previous result", () => {
    const inFlight = render({ stale: true, refreshing: true })
    expect(statusText(inFlight)).toBe("Updating…")
    expect(inFlight).not.toContain("<button")
    // A failed search: the caller's alert reports it, the region stays, empty.
    const failed = render({ stale: true })
    expect(footerClass(failed)).toBe("sr-only")
    expect(statusText(failed)).toBe("")
    expect(failed).not.toContain("<button")
  })

  it("shows nothing at zero rows, but keeps the live region and says so to screen readers", () => {
    const empty = render({ total: 0, hasMore: false })
    expect(footerClass(empty)).toBe("sr-only")
    expect(statusText(empty)).toBe("No entries")
    expect(statusText(render({ total: 0, hasMore: false }, "de"))).toBe("Keine Einträge")
    expect(empty).not.toContain("<button")
    expect(statusText(render({ total: 0, refreshing: true }))).toBe("Updating…")
    expect(footerClass(render({ total: 0, refreshing: true }))).toContain("flex")
  })

  it("keeps the SAME live region from a count to zero rows, so a search that finds nothing is announced", () => {
    // React keeps an element whose type and position stay put; a region that
    // unmounts and comes back with its news already in it is not announced.
    const path = (html: string) =>
      [...html.matchAll(/<(div|p)\b[^>]*?(data-slot="[^"]*")/g)].map((m) => `${m[1]}[${m[2]}]`)
    const states = [
      render(),
      render({ refreshing: true }),
      render({ total: 0, hasMore: false }),
      render({ stale: true }),
    ]
    for (const html of states) {
      expect(path(html)).toEqual([
        'div[data-slot="list-footer"]',
        'p[data-slot="list-footer-status"]',
      ])
      expect(html.match(/role="status"/g)).toHaveLength(1)
    }
    expect(states.map(statusText)).toEqual([
      "Showing 8 of 42 tasks",
      "Showing 8 of 42 tasks Updating…",
      "No entries",
      "",
    ])
  })

  it("leaves the announcing to a caller that owns a live region (announce={false})", () => {
    const html = render({ announce: false, refreshing: true })
    expect(html).not.toContain('role="status"')
    expect(html).toMatch(/<p data-slot="list-footer-status"[^>]*>.*Showing 8 of 42 tasks/)
    expect(html).toContain("Updating…")
    // Nothing visible and no region to keep: nothing at all.
    expect(render({ announce: false, total: 0 })).toBe("")
    expect(render({ announce: false, stale: true })).toBe("")
  })

  it("disables Load more while a page is in flight, and takes label overrides", () => {
    const html = render({ loadingMore: true, labels: { loadingMore: "Fetching…" } })
    const [button] = openingTags(html, "button")
    expect(attribute(button ?? "", "disabled")).toBe("")
    expect(html).toContain("Fetching…</button>")
    expect(render({ hasMore: false })).not.toContain("<button")
  })
})
