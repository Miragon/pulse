// @vitest-environment happy-dom
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Search } from "lucide-react"
import { compile } from "tailwindcss"
import { CountPill, LivePill, StatusBadge } from "../components/Pills.js"
import { setFormatLocale, type Count } from "../format/index.js"
import { Icon } from "../kit/icon.js"
import { MENU_ITEM } from "../kit/menu-item.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { rules, themeCss } from "../theme/theme-css.test-support.js"
import { Button, buttonVariants } from "./button.js"
import { Input } from "./input.js"
import { TabCount, Tabs, TabsList, TabsTrigger } from "./tabs.js"

/**
 * The primitives on the density roles (D9: one compact look, `apps/vscode/docs/adr/ui-foundation.md`):
 * each control takes its height, radius and padding from a role (`min-h-control`,
 * `rounded-button`, …), never a Tailwind step, so the comfortable step on touch reaches it.
 */

afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
})

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)
const variantClasses = (options: Parameters<typeof buttonVariants>[0]) =>
  buttonVariants(options).split(/\s+/)

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "toolbar",
  "link",
] as const

describe("Button on the density roles", () => {
  it.each([
    ["default", "min-h-control"],
    ["sm", "min-h-control"],
    ["xs", "min-h-control-xs"],
    ["lg", "min-h-control-lg"],
    ["icon", "size-control"],
    ["icon-sm", "size-control"],
    ["icon-xs", "size-control-xs"],
    ["icon-lg", "size-control-lg"],
  ] as const)("%s takes %s, the button radius and no Tailwind height", (size, role) => {
    const c = variantClasses({ size })
    expect(c).toContain(role)
    expect(c).toContain("rounded-button")
    expect(c.filter((x) => /^(?:h|size|min-h)-\d/.test(x))).toEqual([])
    expect(c.filter((x) => /^rounded-(?:sm|md|lg)$/.test(x))).toEqual([])
  })

  it.each(BUTTON_VARIANTS.filter((v) => v !== "link"))(
    "%s has a 1 px edge, transparent where it draws none, so forced colours paint it",
    (variant) => {
      const c = variantClasses({ variant })
      expect(c).toContain("border")
      expect(c.some((x) => /^border-(?:transparent|border)$/.test(x))).toBe(true)
    },
  )

  it("in a table cell its focus ring sits flush on it, so a pinned cell never cuts the gap", () => {
    expect(variantClasses({ variant: "outline", size: "sm" })).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-offset-2",
        "in-[td]:focus-visible:ring-offset-0",
      ]),
    )
  })

  it("a link stays a link: no edge", () => {
    expect(variantClasses({ variant: "link" })).toContain("border-0")
  })

  it("the toolbar variant: weight 400, the hover fill, its text in a label that collapses visually under a 36rem bar", () => {
    render(
      <Button variant="toolbar">
        <Icon icon={Search} />
        Find
      </Button>,
    )
    const button = screen.getByRole("button", { name: "Find" })
    const c = classes(button)
    expect(c).toEqual(expect.arrayContaining(["font-normal", "hover:bg-accent", "min-h-control"]))
    expect(c).not.toContain("font-semibold")
    // sr-only keeps the label the button's name; display: none would drop it.
    expect(c).toContain("@max-[36rem]/bar:has-[>svg]:[&>[data-slot=button-label]]:sr-only")
    expect(c.filter((x) => /(?:^|:)hidden$/.test(x))).toEqual([])
    const label = button.querySelector('[data-slot="button-label"]')
    expect(label?.textContent).toBe("Find")
  })

  /** The rules the toolbar variant's own classes compile to inside its query on a 36rem bar. */
  async function toolbarCollapseRules() {
    const tailwind = readFileSync(
      createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
      "utf8",
    )
    const css = (
      await compile(`${tailwind}\n${themeCss.replace(/^@import .*;$/gm, "")}\n@tailwind utilities;`)
    )
      .build(variantClasses({ variant: "toolbar" }))
      .replace(/\s+/g, " ")
    // Only the bar (the container named `bar`) collapses it, never any container.
    expect(css).not.toContain("@container (width < 36rem)")
    const blocks = css.split("@container bar (width < 36rem) {").slice(1)
    // Each block's rules up to its closing brace (rules nest no deeper).
    return blocks.flatMap((block) =>
      [...(block.split(/\}\s*\}/)[0] ?? "").matchAll(/([^{}]+)\{([^{}]+)\}?/g)].map(
        ([, selector, body]) => ({ selector: (selector ?? "").trim(), body: body ?? "" }),
      ),
    )
  }

  it("the toolbar's collapse compiles to a container query that hides the label visually only, and squares the button at the control's height", async () => {
    const collapse = await toolbarCollapseRules()
    expect(collapse.map((rule) => rule.body)).toEqual([
      expect.stringMatching(/^ ?min-width: var\(--control-h\);/),
      expect.stringMatching(/^ ?padding-inline: 0px;/),
      expect.stringMatching(/position: absolute; width: 1px; height: 1px;/),
    ])
    expect(collapse.map((rule) => rule.body).join(" ")).not.toMatch(/display: none/)
    // Every collapse rule holds only for a button with an icon.
    for (const rule of collapse) expect(rule.selector).toMatch(/:has\( ?> ?svg\)/)
  })

  it("a toolbar button without an icon keeps its visible label in a narrow container; one with an icon hides it", async () => {
    const hide = (await toolbarCollapseRules()).find((rule) =>
      rule.body.includes("position: absolute"),
    )
    expect(hide).toBeDefined()
    render(
      <>
        <Button variant="toolbar">Refresh</Button>
        <Button variant="toolbar">
          <Icon icon={Search} />
          Find
        </Button>
      </>,
    )
    const labelOf = (name: string) =>
      screen.getByRole("button", { name }).querySelector('[data-slot="button-label"]')
    expect(labelOf("Refresh")?.matches(hide?.selector ?? "")).toBe(false)
    expect(labelOf("Find")?.matches(hide?.selector ?? "")).toBe(true)
  })
})

describe("fields on the density roles", () => {
  it("Input: the control's minimum height, the sm radius on the ground, its own 2 px focus edge (3 px in high contrast)", () => {
    render(<Input aria-label="Name" />)
    const c = classes(screen.getByLabelText("Name"))
    expect(c).toEqual(
      expect.arrayContaining(["min-h-control", "rounded-sm", "bg-background", "border-input"]),
    )
    expect(c.filter((x) => /^h-\d/.test(x))).toEqual([])
    // The border (1 px) plus a ring of the rest of --focus-width: 2 px, 3 px under hoch.
    expect(c).toEqual(
      expect.arrayContaining([
        "focus-visible:border-focus",
        "focus-visible:ring-[length:calc(var(--focus-width)-1px)]",
      ]),
    )
    expect(c).not.toContain("focus-visible:ring-1")
    expect(rules).toMatch(/\[data-cd-kontrast="hoch"\][^{]*\{[^}]*--focus-width: 3px;/)
  })
})

describe("Tabs: the line bar of a view, the box of a card", () => {
  function lineTabs(count: Count = 3, jobs: Count = 0) {
    return render(
      <LocaleProvider locale="en">
        <Tabs defaultValue="incidents">
          <TabsList variant="line">
            <TabsTrigger value="incidents">
              Incidents
              <TabCount count={count} />
            </TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs
              <TabCount count={jobs} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </LocaleProvider>,
    )
  }

  it("the line list sits in a toolbar-high bar with a rule under it, even without an aside", () => {
    lineTabs()
    const list = screen.getByRole("tablist")
    const bar = list.parentElement
    expect(bar?.getAttribute("data-slot")).toBe("tabs-bar")
    expect(classes(bar)).toEqual(expect.arrayContaining(["border-b", "min-h-toolbar", "flex"]))
    expect(classes(list)).toContain("border-b-0")
    expect(classes(list)).not.toContain("border-b")
  })

  it("the active line tab: the hover fill, 600 and a real 2 px bottom border in --interaction; the others hover on the fill", () => {
    lineTabs()
    const [active, other] = screen.getAllByRole("tab")
    for (const tab of [active, other]) {
      expect(tab?.getAttribute("data-variant")).toBe("line")
      expect(classes(tab)).toEqual(
        expect.arrayContaining([
          "border-b-2",
          "border-transparent",
          "hover:bg-accent",
          "data-[state=active]:bg-accent",
          "data-[state=active]:border-b-interaction",
          "data-[state=active]:font-semibold",
          "focus-visible:ring-inset",
        ]),
      )
      expect(classes(tab).some((c) => c.startsWith("after:"))).toBe(false)
    }
    expect(active?.getAttribute("data-state")).toBe("active")
  })

  it("forced colours draw the active bar, a navigation's current bar and a checked segment's edge in Highlight, the others' in Canvas", () => {
    const forced = rules.slice(rules.indexOf("@media (forced-colors: active)")).replace(/\s+/g, " ")
    expect(forced).toContain(
      '[data-slot="tabs-trigger"][data-variant="line"][data-state="active"], [data-slot="nav-tab"][aria-current="page"], [data-slot="segmented-option"][aria-checked="true"] ) { border-color: Highlight; }',
    )
    // The selected rule is more specific, so it wins over this one in either order.
    expect(forced).toContain(
      ':is( [data-slot="tabs-trigger"][data-variant="line"], [data-slot="nav-tab"], [data-slot="segmented-option"] ) { border-color: Canvas; }',
    )
  })

  it("a tab's count is a quiet pill at 400, always shown, a zero too, and part of the tab's name", () => {
    lineTabs(1234)
    expect(screen.getByRole("tab", { name: /^Incidents\s*1,234$/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /^Jobs\s*0$/ })).toBeTruthy()
    const pill = document.querySelector('[data-slot="tab-count"]')
    expect(classes(pill)).toEqual(
      expect.arrayContaining([
        "rounded-pill",
        "font-normal",
        "tabular-nums",
        "text-muted-foreground",
        "text-small",
      ]),
    )
    expect(pill?.querySelector("[aria-hidden='true']")?.textContent).toBe("1,234")
  })

  it("a capped count shows its bound and an unknown one a dash; the tab's name says them in words", () => {
    lineTabs({ atLeast: 2000 }, null)
    const [capped, unknown] = [...document.querySelectorAll('[data-slot="tab-count"]')]
    expect(capped?.querySelector("[aria-hidden='true']")?.textContent).toBe("≥\u00a02,000")
    expect(unknown?.querySelector("[aria-hidden='true']")?.textContent).toBe("—")
    expect(screen.getByRole("tab", { name: /^Incidents\s*at least 2,000$/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /^Jobs\s*count unknown$/ })).toBeTruthy()
  })

  it("says a count's words and writes its number in the kit's locale, whatever the format locale says", () => {
    // The format locale is English here; the kit's words are German, so is the number's grouping.
    setFormatLocale({ language: "en", locale: "en" })
    render(
      <LocaleProvider locale="de">
        <Tabs defaultValue="jobs">
          <TabsList variant="line">
            <TabsTrigger value="jobs">
              Jobs
              <TabCount count={{ atLeast: 2000 }} />
            </TabsTrigger>
            <TabsTrigger value="incidents">
              Incidents
              <TabCount count={undefined} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </LocaleProvider>,
    )
    expect(screen.getByRole("tab", { name: /^Jobs\s*mindestens 2\.000$/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /^Incidents\s*Anzahl unbekannt$/ })).toBeTruthy()
    const [capped] = [...document.querySelectorAll('[data-slot="tab-count"]')]
    expect(capped?.querySelector("[aria-hidden='true']")?.textContent).toBe("≥\u00a02.000")
    expect(capped?.querySelector(".sr-only")?.textContent).toBe("mindestens 2.000")
  })

  it("an aside sits at the line bar's end, outside the tab list: the bar takes the line's frame", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList
          variant="line"
          aria-label="Views"
          className="mt-2"
          aside={<button>Legend</button>}
        >
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const list = screen.getByRole("tablist", { name: "Views" })
    // The list holds the tabs only; the aside is its sibling in the bar.
    expect(list.querySelectorAll("button")).toHaveLength(2)
    expect(list.contains(screen.getByRole("button", { name: "Legend" }))).toBe(false)
    const bar = list.parentElement
    expect(bar?.getAttribute("data-slot")).toBe("tabs-bar")
    expect(bar?.lastElementChild?.getAttribute("data-slot")).toBe("tabs-aside")
    expect(classes(bar)).toEqual(
      expect.arrayContaining(["border-b", "min-h-toolbar", "pr-gutter", "mt-2"]),
    )
    // The list's start inside its scroll; the bar keeps the side after the aside.
    expect(classes(list)).toEqual(
      expect.arrayContaining(["border-b-0", "flex-1", "min-w-0", "pl-2", "pr-0"]),
    )
    expect(classes(list)).not.toContain("border-b")
    expect(classes(list)).not.toContain("mt-2")
    // The arrows still move between the tabs only.
    const [a, b] = screen.getAllByRole("tab")
    a?.focus()
    expect(document.activeElement).toBe(a)
    expect(b?.getAttribute("tabindex")).toBe("-1")
  })

  it("a default list without an aside is its own box, in no bar", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList className="mt-2">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(document.querySelector('[data-slot="tabs-bar"]')).toBeNull()
    expect(classes(screen.getByRole("tablist"))).toContain("mt-2")
  })

  it("the default list stays the box of a card switch, at least the control's height, its tabs stretched to it, so text at 200 % grows it", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const list = classes(screen.getByRole("tablist"))
    expect(list).toEqual(
      expect.arrayContaining([
        "bg-muted",
        "items-stretch",
        "group-data-[orientation=horizontal]/tabs:min-h-control",
      ]),
    )
    const tab = screen.getByRole("tab")
    expect(tab.getAttribute("data-variant")).toBe("default")
    // No fixed height on the box or its tabs, a percentage one included.
    for (const c of [list, classes(tab)]) {
      expect(c.filter((x) => /(?:^|[:/])h-(?!fit$)/.test(x))).toEqual([])
    }
  })
})

describe("menu entries and badges", () => {
  it("a menu entry is the density's entry height, 400", () => {
    const c = MENU_ITEM.split(/\s+/)
    expect(c).toEqual(expect.arrayContaining(["min-h-entry", "px-3", "font-normal"]))
    expect(c.filter((x) => /^py-/.test(x))).toEqual([])
  })

  it("pills take the badge height; a count pill is a 13 px pill at least as wide as it is high", () => {
    render(
      <>
        <LivePill>Live</LivePill>
        <StatusBadge tone="neutral">Running</StatusBadge>
        <CountPill>7</CountPill>
      </>,
    )
    for (const text of ["Live", "Running"]) {
      const pill = screen.getByText(text).closest("span:not([aria-hidden])")
      expect(classes(pill), text).toContain("min-h-badge")
      expect(classes(pill), text).not.toContain("py-0.5")
    }
    expect(classes(screen.getByText("7"))).toEqual(
      expect.arrayContaining(["min-h-badge", "min-w-5", "rounded-pill", "text-small"]),
    )
  })
})
