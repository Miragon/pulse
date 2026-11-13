// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { Search, Workflow } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { Button } from "../primitives/button.js"
import { classesUnder, compiled, narrowRules } from "./bar-css.test-support.js"
import { StatusBadge } from "./Pills.js"
import { ViewBar } from "./ViewBar.js"

/**
 * ViewBar, the webview's context bar in the kit: the subject, its facts, the actions and the
 * host's meta in one 40 px bar that wraps rather than drops anything (WCAG 1.4.10).
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)
const slot = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="${name}"]`)

describe("ViewBar", () => {
  it("is a 40 px bar on the card with a rule below, its title the view's heading in 13 px at 600", () => {
    const { container } = render(<ViewBar title="Order fulfillment" />)
    const bar = container.querySelector("header")
    expect(bar?.getAttribute("data-slot")).toBe("view-bar")
    // 40 px with its rule (border-box), as the webview's bar.
    expect(classes(bar)).toEqual(
      expect.arrayContaining(["@container/bar", "bg-card", "border-b", "min-h-bar"]),
    )
    expect(classes(bar?.firstElementChild)).toEqual(
      expect.arrayContaining(["flex-wrap", "gap-x-4", "py-1"]),
    )
    const heading = screen.getByRole("heading", { level: 1, name: "Order fulfillment" })
    expect(classes(heading)).toEqual(
      expect.arrayContaining(["text-dense", "font-semibold", "min-w-[6ch]"]),
    )
    // One line, cut with an ellipsis, the whole title in its tooltip.
    expect(heading.getAttribute("title")).toBe("Order fulfillment")
    expect(classes(heading.firstElementChild)).toContain("truncate")
  })

  it("takes the heading level, a suffix inside it and the tooltip of a title that is no text", () => {
    render(
      <ViewBar
        as="h2"
        title={<code>a9b8c7d6</code>}
        titleText="Instance a9b8c7d6"
        titleSuffix={<span>v3</span>}
      />,
    )
    const heading = screen.getByRole("heading", { level: 2 })
    expect(heading.getAttribute("title")).toBe("Instance a9b8c7d6")
    expect(heading.textContent).toBe("a9b8c7d6v3")
  })

  it("lays out the subject, the facts, the actions and the meta in that order", () => {
    const { container } = render(
      <ViewBar
        title="Invoice"
        icon={<Icon icon={Workflow} />}
        badge={<StatusBadge tone="neutral">Suspended</StatusBadge>}
        facts={<span>invoice · v3</span>}
        actions={<Button variant="toolbar">Refresh</Button>}
        access={{ writable: false, note: "Pulse only reads from the engine." }}
        freshness="As of 14:32"
      />,
    )
    const order = ["view-bar-subject", "view-bar-facts", "view-bar-actions", "view-bar-meta"].map(
      (name) => slot(container, name),
    )
    for (const part of order) expect(part).toBeTruthy()
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
    // The subject icon is decorative and 16 px; the facts quiet 13 px text.
    const icon = slot(container, "view-bar-subject")?.querySelector('[aria-hidden="true"]')
    expect(classes(icon)).toContain("[&_svg:not([class*='size-'])]:size-4")
    expect(classes(slot(container, "view-bar-facts"))).toEqual(
      expect.arrayContaining(["text-small", "text-muted-foreground", "flex-wrap"]),
    )
    expect(
      within(slot(container, "view-bar-subject") as HTMLElement).getByText("Suspended"),
    ).toBeTruthy()
  })

  it("draws the access chip from the catalog with the host's note, a divider and the freshness stamp, tabular and right-aligned", () => {
    const { container, rerender } = render(
      <LocaleProvider locale="de">
        <ViewBar
          title="x"
          access={{ writable: true, note: "Pulse may write." }}
          freshness="Stand 14:32"
        />
      </LocaleProvider>,
    )
    const chip = slot(container, "view-bar-access")
    expect(chip?.textContent).toBe(UI_MESSAGES.de.viewBar.writable)
    expect(chip?.getAttribute("title")).toBe("Pulse may write.")
    expect(classes(chip?.querySelector("svg"))).toContain("text-link")
    expect(
      slot(container, "view-bar-meta")?.querySelector('[aria-hidden="true"].w-px'),
    ).toBeTruthy()
    expect(classes(slot(container, "view-bar-freshness"))).toEqual(
      expect.arrayContaining(["min-w-[24ch]", "tabular-nums", "text-right"]),
    )
    rerender(<ViewBar title="x" access={{ writable: false }} />)
    expect(slot(container, "view-bar-access")?.textContent).toBe(UI_MESSAGES.en.viewBar.readOnly)
    // Without the host's live control or stamp, no divider.
    expect(slot(container, "view-bar-meta")?.querySelector(".w-px")).toBeNull()
  })

  it("has a back button named in the locale that the keyboard reaches first", () => {
    const onBack = vi.fn()
    render(
      <ViewBar
        title="Instance"
        onBack={onBack}
        actions={<Button variant="toolbar">Refresh</Button>}
      />,
    )
    const back = screen.getByRole("button", { name: UI_MESSAGES.en.viewBar.back })
    expect(screen.getAllByRole("button")[0]).toBe(back)
    back.focus()
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(classes(back)).toContain("size-control")
  })

  it("renders no meta, no break and no back button it has nothing for", () => {
    const { container } = render(<ViewBar title="Bare" />)
    expect(slot(container, "view-bar-meta")).toBeNull()
    expect(slot(container, "view-bar-actions")).toBeNull()
    expect(container.querySelector(".basis-full")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("cuts the title before any group moves: the subject's minimum counts 6ch of title, not the whole of it", async () => {
    const { container } = render(
      <ViewBar
        title="Order fulfillment with a long process name"
        onBack={vi.fn()}
        icon={<Icon icon={Workflow} />}
        badge={<StatusBadge tone="neutral">Suspended</StatusBadge>}
        facts="order · v3"
        access={{ writable: false }}
        freshness="As of 14:32"
      />,
    )
    const subject = slot(container, "view-bar-subject")!
    // A grid: a flex row's minimum would count the whole title and wrap the facts first.
    expect(classes(subject)).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-[auto_auto_minmax(6ch,max-content)_auto]",
        "min-w-min",
        "max-w-max",
        "flex-[1_1_12rem]",
        "whitespace-nowrap",
      ]),
    )
    // Each part in its own column; an empty column takes no room, the gaps are the parts' margins.
    const back = screen.getByRole("button", { name: UI_MESSAGES.en.viewBar.back })
    expect(classes(back)).toEqual(expect.arrayContaining(["col-start-1", "me-2.5"]))
    expect(classes(subject.querySelector(':scope > span[aria-hidden="true"]'))).toEqual(
      expect.arrayContaining(["col-start-2", "me-2.5"]),
    )
    expect(classes(screen.getByRole("heading"))).toContain("col-start-3")
    expect(classes(screen.getByText("Suspended").parentElement)).toEqual(
      expect.arrayContaining(["col-start-4", "ms-2.5"]),
    )
    const css = await compiled(classesUnder(container.firstElementChild!))
    expect(css).toContain("grid-template-columns: auto auto minmax(6ch,max-content) auto")
    expect(css).toContain("min-width: min-content")
    expect(css).toContain("max-width: max-content")
    expect(css).toContain("flex: 1 1 12rem")
    // The meta wraps rather than widening the document at 320 px.
    expect(classes(slot(container, "view-bar-meta"))).toEqual(
      expect.arrayContaining(["flex-wrap", "min-w-0", "ml-auto"]),
    )
    expect(classes(slot(container, "view-bar-meta"))).not.toContain("shrink-0")
  })

  it("wraps its actions and meta onto a line of their own under 30rem, collapsing toolbar labels under 36rem, both by the bar's own width", async () => {
    const { container } = render(
      <ViewBar
        title="x"
        facts="facts"
        actions={
          <Button variant="toolbar">
            <Icon icon={Search} />
            Find
          </Button>
        }
        freshness="As of 14:32"
      />,
    )
    const css = await compiled(classesUnder(container.firstElementChild!))
    // The line break shows under 30rem; a toolbar label hides visually under 36rem.
    expect(narrowRules(css, "30rem")).toContain("display: block")
    expect(narrowRules(css, "36rem")).toContain("position: absolute")
    expect(css).not.toMatch(/@container \(width/)
    // Nothing is hidden for good: no display: none in any narrow rule.
    expect(narrowRules(css, "30rem") + narrowRules(css, "36rem")).not.toMatch(/display: none/)
    const toolbar = screen.getByRole("button", { name: "Find" })
    expect(toolbar.querySelector('[data-slot="button-label"]')?.textContent).toBe("Find")
  })
})
