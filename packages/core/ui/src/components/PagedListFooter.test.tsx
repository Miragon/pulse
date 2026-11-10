import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { attribute, openingTags, userFacingTexts } from "../render-scan.js"
import { PagedListFooter, type PagedListState } from "./PagedListFooter.js"

/**
 * The paged-list tail on its SSR markup (the house render path): a page-0
 * failure over the previous rows and a load-more failure stay two separate
 * alerts with their own retries; the count is a live region that says
 * "Updating…" while page 0 is in flight and hides while the rows are stale.
 */

const noop = (): void => {}
const loadMore = (): void => {}
const retry = (): void => {}

/** A settled page 0: two of three rows on screen, nothing in flight. */
function paged(overrides: Partial<PagedListState> = {}): PagedListState {
  return {
    items: ["a", "b"],
    firstPage: {},
    total: 3,
    hasMore: true,
    loadMore,
    retry,
    ...overrides,
  }
}

function render(state: PagedListState, locale = "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <PagedListFooter paged={state} noun="items" />
    </LocaleProvider>,
  )
}

const alerts = (html: string) =>
  openingTags(html, "div").filter((t) => attribute(t, "role") === "alert")
const statusOf = (html: string) =>
  /<p role="status"[^>]*>([\s\S]*?)<\/p>/
    .exec(html)?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

describe("PagedListFooter: settled and in-flight states", () => {
  it("a settled page: the count in the live region, Load more, no alert", () => {
    const html = render(paged())
    expect(statusOf(html)).toBe("Showing 2 of 3 items")
    expect(alerts(html)).toHaveLength(0)
    expect(html).toContain("Load more</button>")
  })

  it("a search that finds nothing: the live region stays and says so, nothing visible", () => {
    const html = render(paged({ items: [], total: 0, hasMore: false }))
    expect(statusOf(html)).toBe("No entries")
    expect(html.match(/role="status"/g)).toHaveLength(1)
    const footer = openingTags(html, "div").find((t) => /data-slot="list-footer"/.test(t)) ?? ""
    expect(attribute(footer, "class")).toBe("sr-only")
    expect(statusOf(render(paged({ items: [], total: 0, hasMore: false }), "de"))).toBe(
      UI_MESSAGES.de.listFooter.noResults,
    )
  })

  it("a new search in flight: a visible Updating…, no count beside the previous rows", () => {
    const html = render(paged({ stale: true, refreshing: true }))
    expect(statusOf(html)).toBe("Updating…")
    expect(html).not.toMatch(/Showing/)
    expect(html).not.toContain("Load more")
  })

  it("a same-filter refetch: Updating… and the count of THIS filter stay", () => {
    expect(statusOf(render(paged({ refreshing: true })))).toBe("Showing 2 of 3 items Updating…")
  })
})

describe("PagedListFooter: two failures, two retries", () => {
  const failed = new Error("[503] engine down")

  it("a failed search over the previous rows: a warning alert whose retry re-runs page 0", () => {
    const html = render(paged({ stale: true, error: failed }))
    const [alert] = alerts(html)
    expect(attribute(alert ?? "", "data-tone")).toBe("warning")
    const texts = userFacingTexts(html).map((t) => t.value)
    expect(texts).toContain(UI_MESSAGES.en.listFooter.refreshFailed)
    expect(texts).toContain(UI_MESSAGES.en.listFooter.refreshFailedHint)
    // The raw reason sits under Details, never in the sentence.
    expect(html).toMatch(/<summary[^>]*>Details<\/summary><pre[^>]*>\[503\] engine down<\/pre>/)
    expect(html).toContain("Try again</button>")
    expect(html).not.toMatch(/Showing/)
  })

  it("leaves a page-0 failure WITHOUT rows on screen to the caller's loading guard", () => {
    expect(alerts(render(paged({ firstPage: null, error: failed })))).toHaveLength(0)
    expect(alerts(render(paged({ firstPage: undefined, error: failed })))).toHaveLength(0)
  })

  it("a failed load-more: a danger alert next to a still-current count", () => {
    const html = render(paged({ loadMoreError: failed }))
    const [alert] = alerts(html)
    expect(attribute(alert ?? "", "data-tone")).toBe("danger")
    expect(userFacingTexts(html).map((t) => t.value)).toContain(
      UI_MESSAGES.en.listFooter.loadMoreFailed,
    )
    expect(statusOf(html)).toBe("Showing 2 of 3 items")
  })

  it("keeps both failures apart, each with its own retry, in German", () => {
    const html = render(paged({ stale: true, error: failed, loadMoreError: failed }), "de")
    expect(alerts(html).map((a) => attribute(a, "data-tone"))).toEqual(["warning", "danger"])
    const texts = userFacingTexts(html).map((t) => t.value)
    expect(texts).toContain("Die Liste konnte nicht aktualisiert werden")
    expect(texts).toContain("Weitere Einträge konnten nicht geladen werden")
    expect(openingTags(html, "button")).toHaveLength(2)
    expect(html.match(/Erneut versuchen<\/button>/g)).toHaveLength(2)
  })

  it("offers no retry where the caller says none changes the failure, and keeps the others", () => {
    const refused = new Error("refused until someone changes a setting")
    const canRetry = (error: Error) => error !== refused
    const html = render(paged({ stale: true, error: refused, loadMoreError: refused, canRetry }))
    expect(alerts(html)).toHaveLength(2)
    expect(html).not.toContain("Try again</button>")
    const mixed = render(paged({ stale: true, error: refused, loadMoreError: failed, canRetry }))
    expect(mixed.match(/Try again<\/button>/g)).toHaveLength(1)
  })

  it("offers no retry it cannot run, and takes the caller's labels", () => {
    // A paged state without a page-0 retry callback.
    const noRetryState = paged({ error: failed })
    delete noRetryState.retry
    const withoutRetry = render(noRetryState)
    expect(alerts(withoutRetry)).toHaveLength(1)
    // Only Load more is a button: the alert offers no retry without paged.retry.
    expect(openingTags(withoutRetry, "button")).toHaveLength(1)
    expect(withoutRetry).not.toContain("Try again</button>")
    const custom = renderToStaticMarkup(
      <PagedListFooter
        paged={paged({ loadMoreError: failed, loadMore: noop })}
        labels={{ loadMoreFailed: "More tasks didn't load" }}
        retryLabel="Load again"
      />,
    )
    expect(userFacingTexts(custom).map((t) => t.value)).toContain("More tasks didn't load")
    expect(custom).toContain("Load again</button>")
  })
})
