// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { RotateCcw } from "lucide-react"
import { TONE_BORDER, TONE_ICON } from "../lib/tone-utils.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { classesUnder, compiled, narrowRules } from "./bar-css.test-support.js"
import { StatusStrip, type StatusStripAction } from "./StatusStrip.js"

/**
 * StatusStrip, the webview's docked notice: one line on the tone's status surface, a live
 * region that announces when it appears and when its words change, actions outside it.
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)
const strip = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="status-strip"]')!

describe("StatusStrip", () => {
  it.each(["danger", "warning", "info"] as const)(
    "draws the %s tone on its status surface with a rule in the tone, no 4 px edge",
    (tone) => {
      const { container } = render(<StatusStrip tone={tone} title="Engine offline" />)
      const c = classes(strip(container))
      expect(c).toEqual(
        expect.arrayContaining([
          `bg-${tone}-surface`,
          "border-b",
          TONE_BORDER[tone],
          "@container/bar",
        ]),
      )
      expect(c.filter((x) => /border-l-4|bg-\w+-soft/.test(x))).toEqual([])
      // 2 px in high contrast, CanvasText in forced colours; the icon keeps its tone there.
      expect(c).toEqual(
        expect.arrayContaining([
          "in-[[data-cd-kontrast=hoch]]:border-b-2",
          "forced-colors:border-[color:CanvasText]",
        ]),
      )
      const icon = strip(container).querySelector("svg")
      expect(classes(icon)).toEqual(
        expect.arrayContaining([TONE_ICON[tone], "forced-colors:forced-color-adjust-none"]),
      )
      expect(icon?.getAttribute("width")).toBe("16")
    },
  )

  it("is an alert for danger and a status otherwise, its message alone the live region", () => {
    const { rerender } = render(
      <StatusStrip tone="danger" title="Retry failed" detail="Engine refused it." />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toBe("Retry failedEngine refused it.")
    expect(alert.getAttribute("aria-atomic")).toBe("true")
    expect(alert.getAttribute("title")).toBe("Retry failed Engine refused it.")
    rerender(<StatusStrip tone="info" title="Live updates paused" />)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toBe("Live updates paused")
  })

  it("announces once: a re-render and a busy action leave the live region as it was; new words change it", () => {
    const retry: StatusStripAction = { label: "Retry", icon: RotateCcw, onClick: vi.fn() }
    const { container, rerender } = render(
      <StatusStrip tone="danger" title="Retry failed" detail="Try again." actions={[retry]} />,
    )
    const region = screen.getByRole("alert")
    const seen: MutationRecord[] = []
    const observer = new MutationObserver((records) => seen.push(...records))
    observer.observe(region, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    rerender(
      <StatusStrip tone="danger" title="Retry failed" detail="Try again." actions={[retry]} />,
    )
    rerender(
      <StatusStrip
        tone="danger"
        title="Retry failed"
        detail="Try again."
        actions={[{ ...retry, busyLabel: "Retrying…" }]}
      />,
    )
    expect(observer.takeRecords().concat(seen)).toEqual([])
    expect(screen.getByRole("alert")).toBe(region)
    expect(region.contains(container.querySelector('[data-slot="status-strip-actions"]'))).toBe(
      false,
    )
    rerender(<StatusStrip tone="danger" title="Retry failed again" detail="Try again." />)
    expect(region.textContent).toBe("Retry failed againTry again.")
    observer.disconnect()
  })

  it("runs an action by click and keyboard as a 24 px button with icon and label", () => {
    const onClick = vi.fn()
    render(
      <StatusStrip
        tone="warning"
        title="Stale"
        actions={[{ label: "Reload", icon: RotateCcw, onClick }]}
      />,
    )
    const button = screen.getByRole("button", { name: "Reload" })
    expect(classes(button)).toEqual(expect.arrayContaining(["min-h-control-xs", "border-border"]))
    expect(button.querySelector('[data-slot="button-label"]')?.textContent).toBe("Reload")
    button.focus()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(button)
  })

  it("shows a busy action by its words and a spinner, refusing a press through aria-disabled and keeping the focus", () => {
    const onClick = vi.fn()
    render(
      <StatusStrip
        tone="danger"
        title="x"
        actions={[{ label: "Retry", icon: RotateCcw, onClick, busyLabel: "Retrying…" }]}
      />,
    )
    const button = screen.getByRole("button", { name: "Retrying…" })
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.hasAttribute("disabled")).toBe(false)
    expect(classes(button.querySelector("svg"))).toEqual(
      expect.arrayContaining([
        "motion-safe:animate-spin",
        "[.cd-shell-reduce-motion_&]:animate-none",
      ]),
    )
    button.focus()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button)
  })

  it("refuses a disabled action the same way, still in the tab order", () => {
    const onClick = vi.fn()
    render(
      <StatusStrip tone="info" title="x" actions={[{ label: "Open", onClick, disabled: true }]} />,
    )
    const button = screen.getByRole("button", { name: "Open" })
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.tabIndex).toBe(0)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("keeps the raw reason behind Details: collapsed, outside the live region, opened under the line by its button", () => {
    const retry = vi.fn()
    const { container } = render(
      <StatusStrip
        tone="warning"
        title="Couldn't refresh this view"
        detail="Something went wrong."
        details="[404 NotFoundException] pi-1 does not exist"
        actions={[{ label: "Try again", icon: RotateCcw, onClick: retry }]}
      />,
    )
    const toggle = screen.getByRole("button", { name: "Details" })
    const panel = container.querySelector<HTMLElement>('[data-slot="status-strip-details"]')!
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(panel.hidden).toBe(true)
    expect(panel.textContent).toBe("[404 NotFoundException] pi-1 does not exist")
    // Never part of what the strip announces; the Details button sits before the actions.
    expect(screen.getByRole("status").textContent).not.toContain("pi-1")
    const buttons = within(strip(container)).getAllByRole("button")
    expect(buttons.map((button) => button.getAttribute("title"))).toEqual(["Details", "Try again"])
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(panel.hidden).toBe(false)
    expect(classes(panel)).toEqual(
      expect.arrayContaining(["font-mono", "text-small", "whitespace-pre-wrap"]),
    )
    fireEvent.click(toggle)
    expect(panel.hidden).toBe(true)
    expect(retry).not.toHaveBeenCalled()
  })

  it("draws no Details button without a reason, and takes its words from the locale or the caller", () => {
    const { rerender } = render(<StatusStrip tone="info" title="Stale" details="" />)
    expect(screen.queryByRole("button")).toBeNull()
    rerender(
      <LocaleProvider locale="de">
        <StatusStrip tone="info" title="Veraltet" details="raw" />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy()
    rerender(<StatusStrip tone="info" title="Stale" details="raw" detailsLabel="Engine text" />)
    expect(screen.getByRole("button", { name: "Engine text" })).toBeTruthy()
  })

  it("keeps the title before the detail, the detail cut first; under 30rem the line wraps and under 36rem a label collapses, by the strip's own width", async () => {
    const { container } = render(
      <StatusStrip
        tone="warning"
        title="Stale"
        detail="The engine answered late."
        actions={[{ label: "Reload", icon: RotateCcw, onClick: vi.fn() }]}
      />,
    )
    const [title, detail] = Array.from(screen.getByRole("status").children)
    expect(classes(title)).toEqual(
      expect.arrayContaining(["font-semibold", "shrink-0", "max-w-full"]),
    )
    expect(classes(detail)).toContain("shrink-[1000]")
    const css = await compiled(classesUnder(strip(container)))
    const under30 = narrowRules(css, "30rem")
    expect(under30).toContain("white-space: normal")
    expect(under30).toContain("flex-wrap: wrap")
    expect(under30).toContain("overflow-wrap: anywhere")
    expect(narrowRules(css, "36rem")).toContain("position: absolute")
    expect(css).not.toMatch(/display: none/)
  })
})
