// @vitest-environment happy-dom
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { AppEmptyState, KOMET_MIN_SIZE, KometMark } from "./brand-mark.js"
import { KOMET_SVG, KOMET_SVG_SHA256, KOMET_SVG_VERSION } from "./komet-svg.js"
import { TableEmptyState } from "./table.js"

afterEach(cleanup)

const UPSTREAM_REL = join("skills", "corporate-design", "assets", "logo", "miragon-komet-blau.svg")

/** A reachable miragon-brand checkout of this version (a Claude plugin cache), or null (CI). */
function findUpstream(): string | null {
  const explicit = process.env.MIRAGON_BRAND_DIR
  if (explicit) {
    const file = join(explicit, UPSTREAM_REL)
    return existsSync(file) ? file : null
  }
  let homes: string[]
  try {
    homes = readdirSync(homedir()).filter((name) => name.startsWith(".claude"))
  } catch {
    return null
  }
  for (const dir of homes) {
    const cache = join(homedir(), dir, "plugins", "cache")
    if (!existsSync(cache)) continue
    for (const marketplace of readdirSync(cache)) {
      const file = join(cache, marketplace, "miragon-brand", KOMET_SVG_VERSION, UPSTREAM_REL)
      if (existsSync(file)) return file
    }
  }
  return null
}

describe("the Komet is the CI's file, unchanged (modeler-tool-design §11)", () => {
  it("matches the pinned SHA-256 of miragon-brand's miragon-komet-blau.svg", () => {
    expect(createHash("sha256").update(KOMET_SVG).digest("hex")).toBe(KOMET_SVG_SHA256)
  })

  it("is byte-equal to the plugin's file where a checkout is reachable", () => {
    const upstream = findUpstream()
    if (!upstream) return
    expect(KOMET_SVG).toBe(readFileSync(upstream, "utf8"))
  })
})

describe("KometMark (app-level signature only)", () => {
  it("inlines the unchanged mark, decorative, at 48 px by default", () => {
    const { container } = render(<KometMark />)
    const mark = container.querySelector('[data-brand-mark="komet"]') as HTMLElement
    // The DOM re-serialises the markup; the parsed tree is the CI file's.
    const parsed = new DOMParser().parseFromString(KOMET_SVG, "image/svg+xml").documentElement
    const svg = mark.querySelector("svg")!
    expect(svg.getAttribute("viewBox")).toBe(parsed.getAttribute("viewBox"))
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#335de5")
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(
      parsed.querySelector("path")?.getAttribute("d"),
    )
    expect(mark.getAttribute("aria-hidden")).toBe("true")
    expect(mark.style.width).toBe("48px")
    expect(mark.style.height).toBe("48px")
  })

  it("never renders below 24 px", () => {
    const { container } = render(<KometMark size={12} />)
    const mark = container.querySelector('[data-brand-mark="komet"]') as HTMLElement
    expect(KOMET_MIN_SIZE).toBe(24)
    expect(mark.style.width).toBe("24px")
  })

  it("hangs on the theme slot a customer brand empties (--brand-mark-display)", () => {
    const { container } = render(<KometMark />)
    const mark = container.querySelector('[data-brand-mark="komet"]') as HTMLElement
    expect(mark.getAttribute("style")).toContain("display: var(--brand-mark-display, inline-flex)")
  })

  it("stands alone as an image when labelled", () => {
    render(<KometMark label="Miragon" />)
    expect(screen.getByRole("img", { name: "Miragon" })).toBeTruthy()
  })
})

describe("empty states (U10)", () => {
  it("AppEmptyState: the Komet over a 600 heading, a help line and two actions", () => {
    const { container } = render(
      <AppEmptyState
        title="No engines yet"
        description="Add an engine to start."
        action={<button type="button">Add engine</button>}
        secondaryAction={<button type="button">Show example</button>}
      />,
    )
    expect(container.querySelector('[data-brand-mark="komet"]')).toBeTruthy()
    const heading = screen.getByRole("heading", { level: 2, name: "No engines yet" })
    expect(heading.className).toContain("font-semibold")
    expect(screen.getByText("Add an engine to start.")).toBeTruthy()
    expect(screen.getAllByRole("button")).toHaveLength(2)
  })

  it("TableEmptyState: 'no data' is a quiet Inbox, 'all done' a success CircleCheck", () => {
    const { container } = render(
      <>
        <TableEmptyState>No jobs found</TableEmptyState>
        <TableEmptyState variant="done" description="Nothing is failing right now.">
          No open incidents
        </TableEmptyState>
      </>,
    )
    const [empty, done] = container.querySelectorAll("[data-empty-variant]")
    expect(empty.getAttribute("data-empty-variant")).toBe("empty")
    expect(empty.querySelector("svg")?.getAttribute("class")).toContain("lucide-inbox")
    expect(empty.querySelector('[aria-hidden="true"]')?.className).toContain(
      "text-muted-foreground",
    )
    expect(done.getAttribute("data-empty-variant")).toBe("done")
    expect(done.querySelector("svg")?.getAttribute("class")).toContain("lucide-circle-check")
    expect(done.querySelector('[aria-hidden="true"]')?.className).toContain("text-success")
    expect(screen.getByText("Nothing is failing right now.")).toBeTruthy()
    // It stands in for a table: its title is no heading.
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.getByText("No open incidents").tagName).toBe("P")
  })

  it("TableEmptyState: a concrete icon and actions where the caller has them", () => {
    render(
      <TableEmptyState
        icon={<svg data-testid="search-x" />}
        action={<button type="button">Clear search</button>}
        titleAs="h3"
      >
        No matches
      </TableEmptyState>,
    )
    expect(screen.getByTestId("search-x")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 3, name: "No matches" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy()
  })
})
