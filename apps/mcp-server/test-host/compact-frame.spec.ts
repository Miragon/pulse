import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import { HEALTHY_ENGINE, REALISTIC_ENGINE, REALISTIC_HOST_ENV } from "./engines.js"

/**
 * The cockpit's frame in the one compact look (D9) where the reader's setup differs from a desk:
 * a touch screen takes the comfortable step, text at 200 % grows every control around it, a
 * 320 px card keeps every fact and id of a view's bar and every section of the head, the head's
 * sections (pulse-ui's NavTabs) open by keyboard, forced colours keep the open tab, the head's
 * open section and a docked strip, a fact's term sits on its value's baseline, and the detail
 * views pass axe, their BPMN diagram included, with a failed refresh docked under the bar.
 */

const INSTANCE_ARGS = {
  engine: HEALTHY_ENGINE,
  view: "instance-detail",
  processInstanceId: "pi-invoice-42",
}
const PROCESS_ARGS = {
  engine: HEALTHY_ENGINE,
  view: "process-detail",
  processDefinitionKey: "invoice",
}
const INSTANCES_ARGS = { engine: REALISTIC_ENGINE, view: "process-instances" }
/** The stub's open incident at `chargeCard` of the invoice instance, its job without retries. */
const INCIDENT_ARGS = { engine: HEALTHY_ENGINE, view: "incident-detail", incidentId: "inc-charge" }

async function openView(
  page: Page,
  args: Record<string, unknown>,
  {
    width = 760,
    hostEnv = "HOST_SIM_URL",
    theme = "light",
  }: { width?: number; hostEnv?: string; theme?: "light" | "dark" } = {},
): Promise<FrameLocator> {
  const base = process.env[hostEnv]
  if (!base) throw new Error(`${hostEnv} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify(args),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme,
    width: String(width),
  })
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

/**
 * The instance view's next reads fail as an engine going away answers them (the server's own
 * error text), then the cockpit's head refreshes: the view keeps its data and docks the failed
 * refresh's strip under its bar.
 */
async function failRefresh(page: Page, app: FrameLocator): Promise<Locator> {
  await page.route("**/host/call", async (route) => {
    const call = route.request().postDataJSON() as { name?: string }
    if (call.name !== "engine_instance_detail_data") return route.continue()
    return route.fulfill({
      json: {
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "[503 ProcessEngineException] Engine is shutting down (engine stub)",
            },
          ],
        },
      },
    })
  })
  await app
    .getByRole("button", { name: /^Refresh/ })
    .first()
    .click()
  const strip = app.locator('[data-slot="status-strip"]').first()
  await expect(strip).toBeVisible({ timeout: 20_000 })
  return strip
}

/** The view's bars from edge to edge: the cockpit's head and the route's own bar. */
const bars = (app: FrameLocator) =>
  app.locator('[data-slot="cockpit-head"], [data-slot="view-bar"]')

test.describe("a list's filter bar", () => {
  test("the instance list's docks under the view's bar from edge to edge, its scope on the content's edge", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCES_ARGS, { hostEnv: REALISTIC_HOST_ENV })
    const toolbar = app.locator('[data-slot="toolbar"]').first()
    await expect(toolbar).toBeVisible({ timeout: 15_000 })
    const seen = await toolbar.evaluate((bar) => {
      const card = document.querySelector('[data-slot="widget-shell"]')!.getBoundingClientRect()
      const own = bar.getBoundingClientRect()
      const scope = bar.querySelector('[data-slot="segmented-control"]')!.getBoundingClientRect()
      const field = bar.querySelector('[data-slot="search-field"]')!.getBoundingClientRect()
      return {
        under: bar.previousElementSibling?.getAttribute("data-slot"),
        left: own.left - card.left,
        right: card.right - own.right,
        scope: scope.left - card.left,
        // The search after the scope on the same line, 8 px apart (the webview's filter bar).
        fieldAfterScope: Math.round(field.left - scope.right),
        oneLine:
          Math.round(field.top + field.height / 2) === Math.round(scope.top + scope.height / 2),
      }
    })
    expect(seen).toEqual({
      under: "view-bar",
      left: 0,
      right: 0,
      scope: 12,
      fieldAfterScope: 8,
      oneLine: true,
    })
  })
})

test.describe("touch (a coarse pointer)", () => {
  test.use({ hasTouch: true, isMobile: true })

  test("the comfortable step: 48 px bars, 36 px controls, 32 px row actions, 40 px rows, 16 px field text, copy buttons shown", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCES_ARGS, { hostEnv: REALISTIC_HOST_ENV })
    const region = app.getByRole("table").first()
    await expect(region.getByRole("row").nth(1)).toBeVisible({ timeout: 15_000 })

    for (const height of await bars(app).evaluateAll((all) =>
      all.map((bar) => Math.round(bar.getBoundingClientRect().height)),
    )) {
      expect(height, "a bar on touch").toBeGreaterThanOrEqual(48)
    }
    const heightsOf = (selector: string) =>
      app.locator(selector).evaluateAll((all) =>
        all
          .filter((el) => el.getAttribute("aria-label")?.startsWith("Copy") !== true)
          .map((el) => ({
            name: el.getAttribute("aria-label") ?? el.textContent ?? "",
            height: Math.round(el.getBoundingClientRect().height),
          })),
      )
    // Every control of the bars, the trail's crumbs too.
    const controls = await heightsOf(
      '[data-slot="view-bar"] button, [data-slot="cockpit-head"] button',
    )
    expect(controls.length).toBeGreaterThanOrEqual(3)
    for (const control of controls) {
      expect(control.height, `${control.name}: a control on touch`).toBeGreaterThanOrEqual(36)
    }
    // A row's actions are the xs buttons, a 32 px target on touch inside the 40 px row.
    const actions = await heightsOf('tbody button[class*="min-h-control"]')
    expect(actions.length).toBeGreaterThan(3)
    for (const action of actions) {
      expect(action.height, `${action.name}: a row's action on touch`).toBeGreaterThanOrEqual(32)
    }
    const rows = await region
      .locator("tbody tr")
      .evaluateAll((all) => all.map((row) => Math.round(row.getBoundingClientRect().height)))
    for (const height of rows) expect(height, "a row on touch").toBeGreaterThanOrEqual(40)
    // A field's text is 16 px on touch, so iOS never zooms into the page when it takes focus.
    const search = app.getByRole("searchbox").or(app.locator('input[type="search"], input')).first()
    expect(await search.evaluate((input) => getComputedStyle(input).fontSize)).toBe("16px")
    // No hover to reveal them: a row's copy buttons always show.
    const copies = await region
      .getByRole("button", { name: /^Copy/ })
      .evaluateAll((all) => all.map((button) => getComputedStyle(button).opacity))
    expect(copies.length).toBeGreaterThan(0)
    expect(new Set(copies)).toEqual(new Set(["1"]))
  })
})

test.describe("text at 200 %", () => {
  for (const [name, args, hostEnv] of [
    ["the process view", PROCESS_ARGS, "HOST_SIM_URL"],
    ["the instance list", INSTANCES_ARGS, REALISTIC_HOST_ENV],
  ] as const) {
    test(`${name}: every button, field and segment grows around its text, none clips it`, async ({
      page,
    }) => {
      const app = await openView(page, args, { hostEnv, width: 960 })
      await expect(bars(app).nth(1)).toBeVisible({ timeout: 15_000 })
      await expect(app.getByRole("button").first()).toBeVisible()
      // The reader's font size: every role of the kit is rem, so it all scales.
      await app.locator("html").evaluate((html) => {
        html.style.fontSize = "32px"
      })
      const clipped = await app.locator("body").evaluate((body) =>
        [...body.querySelectorAll<HTMLElement>('button, a[href], input, select, [role="radio"]')]
          .filter((el) => el.getClientRects().length > 0)
          .flatMap((el) => {
            const style = getComputedStyle(el)
            const name = `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent ?? ""}`
            const box = el.getBoundingClientRect()
            const text = parseFloat(style.fontSize)
            const tooLow =
              el.tagName === "INPUT" || el.tagName === "SELECT"
                ? box.height < text * 1.2
                : el.scrollHeight > el.clientHeight + 1
            return tooLow
              ? [`${name.trim()}: ${Math.round(box.height)} px for ${text} px text`]
              : []
          }),
      )
      expect(clipped).toEqual([])
      const rootText = await app
        .locator('[data-slot="view-bar"] h1')
        .first()
        .evaluate((heading) => getComputedStyle(heading).fontSize)
      expect(rootText, "the bar's title at 13 px of a 16 px root, doubled").toBe("26px")
    })
  }
})

test.describe("a 320 px card", () => {
  test("the instance's bar keeps its facts and its id whole, the document never scrolls sideways", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCE_ARGS, { width: 320 })
    const bar = app.locator('[data-slot="view-bar"]').first()
    await expect(bar).toBeVisible({ timeout: 15_000 })
    const facts = bar.locator('[data-slot="view-bar-facts"]')
    await expect(facts).toContainText("Invoice Receipt")
    await expect(facts).toContainText("pi-invoice-42")
    await expect(facts.getByRole("button", { name: /^Copy/ })).toBeVisible()
    const layout = await app.locator("html").evaluate((html) => {
      const facts = html.querySelector('[data-slot="view-bar"] [data-slot="view-bar-facts"]')!
      const parts = [...facts.querySelectorAll<HTMLElement>("*")].filter(
        (el) => el.children.length === 0 && el.textContent,
      )
      return {
        scrollWidth: html.scrollWidth,
        clientWidth: html.clientWidth,
        right: Math.max(...parts.map((part) => part.getBoundingClientRect().right)),
        cut: parts
          .filter((part) => part.scrollWidth > part.clientWidth + 1)
          .map((part) => part.textContent),
      }
    })
    expect(layout.scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(
      layout.clientWidth,
    )
    expect(layout.right, "every fact inside the card").toBeLessThanOrEqual(layout.clientWidth)
    expect(layout.cut, "no fact cut").toEqual([])
    // The actions start a line of their own under 30rem, each keeping its name.
    const actions = bar.locator('[data-slot="view-bar-actions"]')
    await expect(actions.getByRole("button", { name: "View process" })).toBeVisible()
    await expect(actions.getByRole("button", { name: /chat/ })).toBeVisible()
  })
})

test.describe("the head's sections (pulse-ui's NavTabs)", () => {
  test("a named navigation of buttons: Tab reaches each in turn, Enter opens one, aria-current follows", async ({
    page,
  }) => {
    const app = await openView(page, { engine: HEALTHY_ENGINE })
    const sections = app.getByRole("navigation", { name: "Cockpit sections" })
    const overview = sections.getByRole("button", { name: "Overview" })
    const incidents = sections.getByRole("button", { name: "Incidents" })
    await expect(overview).toHaveAttribute("aria-current", "page", { timeout: 15_000 })
    await expect(sections.getByRole("listitem")).toHaveCount(3)
    // The open section's 2 px bar lands on the head's rule: the item reaches its bottom edge.
    const edges = await overview.evaluate((item) => {
      const head = item.closest('[data-slot="cockpit-head"]')!.getBoundingClientRect()
      const box = item.getBoundingClientRect()
      return { item: Math.round(box.bottom), head: Math.round(head.bottom) }
    })
    expect(edges.item).toBe(edges.head)
    await overview.focus()
    await page.keyboard.press("Tab")
    await expect(incidents).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(incidents).toHaveAttribute("aria-current", "page", { timeout: 15_000 })
    await expect(overview).not.toHaveAttribute("aria-current", /.*/)
  })

  test("a 320 px card keeps every section whole and inside it", async ({ page }) => {
    const app = await openView(page, { engine: HEALTHY_ENGINE }, { width: 320 })
    const sections = app.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Overview" })).toBeVisible({
      timeout: 15_000,
    })
    const seen = await sections.evaluate((nav) => {
      const width = document.documentElement.clientWidth
      const items = [...nav.querySelectorAll("button")].map((item) => {
        const box = item.getBoundingClientRect()
        return {
          name: item.textContent,
          inside: box.left >= 0 && box.right <= width,
          whole: item.scrollWidth <= item.clientWidth,
        }
      })
      return { items, scrolls: document.documentElement.scrollWidth > width }
    })
    expect(seen.scrolls, "the document never scrolls sideways").toBe(false)
    expect(seen.items.map((item) => item.name)).toEqual(["Overview", "Incidents", "Jobs"])
    for (const item of seen.items) {
      expect(item, `${item.name} whole and inside the card`).toEqual({
        name: item.name,
        inside: true,
        whole: true,
      })
    }
  })
})

test.describe("forced colours", () => {
  test("the open tab of a view's tab bar keeps its bar, in Highlight", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openView(page, INSTANCE_ARGS)
    const tab = app.getByRole("tab", { selected: true })
    await expect(tab).toBeVisible({ timeout: 15_000 })
    const seen = await tab.evaluate((el) => {
      const probe = document.createElement("i")
      probe.style.color = "Highlight"
      document.body.append(probe)
      const highlight = getComputedStyle(probe).color
      probe.remove()
      const style = getComputedStyle(el)
      return {
        highlight,
        bar: `${style.borderBottomStyle} ${style.borderBottomWidth} ${style.borderBottomColor}`,
      }
    })
    expect(seen.bar).toBe(`solid 2px ${seen.highlight}`)
  })

  test("the head's open section keeps its bar in Highlight, the others draw none", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openView(page, { engine: HEALTHY_ENGINE })
    const sections = app.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
      { timeout: 15_000 },
    )
    const seen = await sections.evaluate((nav) => {
      const colour = (name: string) => {
        const probe = document.createElement("i")
        probe.style.color = name
        document.body.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }
      const edge = (el: Element) => {
        const style = getComputedStyle(el)
        return `${style.borderBottomStyle} ${style.borderBottomWidth} ${style.borderBottomColor}`
      }
      const buttons = [...nav.querySelectorAll("button")]
      return {
        highlight: colour("Highlight"),
        canvas: colour("Canvas"),
        open: buttons.filter((b) => b.getAttribute("aria-current") === "page").map(edge),
        others: buttons.filter((b) => b.getAttribute("aria-current") !== "page").map(edge),
      }
    })
    expect(seen.open).toEqual([`solid 2px ${seen.highlight}`])
    expect(seen.others.length).toBeGreaterThan(0)
    for (const edge of seen.others) expect(edge).toBe(`solid 2px ${seen.canvas}`)
  })

  test("a failed refresh's docked strip keeps its edge in CanvasText and its icon in its tone", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openView(page, INSTANCE_ARGS)
    await expect(app.getByRole("tab", { selected: true })).toBeVisible({ timeout: 15_000 })
    const strip = await failRefresh(page, app)
    // Docked right under the view's bar.
    expect(await strip.evaluate((el) => el.previousElementSibling?.getAttribute("data-slot"))).toBe(
      "view-bar",
    )
    const seen = await strip.evaluate((el) => {
      const colour = (name: string) => {
        const probe = document.createElement("i")
        probe.style.color = name
        document.body.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }
      const style = getComputedStyle(el)
      const icon = el.querySelector("svg")!
      const box = icon.getBoundingClientRect()
      return {
        canvasText: colour("CanvasText"),
        canvas: colour("Canvas"),
        edge: `${style.borderBottomStyle} ${style.borderBottomWidth} ${style.borderBottomColor}`,
        icon: getComputedStyle(icon).color,
        adjust: getComputedStyle(icon).forcedColorAdjust,
        size: [Math.round(box.width), Math.round(box.height)],
      }
    })
    expect(seen.edge).toBe(`solid 1px ${seen.canvasText}`)
    expect(seen.size).toEqual([16, 16])
    // The tone's icon keeps its own colour on the system's canvas.
    expect(seen.adjust).toBe("none")
    expect(seen.icon).not.toBe(seen.canvas)
    expect(seen.icon).not.toBe(seen.canvasText)
  })
})

/**
 * Each term's and its value's first visible text baseline, from the top of the facts list: an
 * empty inline-block put before that text sits with its bottom on the line's baseline.
 */
async function factBaselines(facts: Locator) {
  return facts.evaluate((list) => {
    const top = list.getBoundingClientRect().top
    const firstText = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        if (node.textContent?.trim() && parent && parent.closest(".sr-only") === null) return node
      }
      return null
    }
    const baselineOf = (el: Element) => {
      const text = firstText(el)
      if (!text?.parentNode) return Number.NaN
      // Wrapped, so a text right inside a flex container keeps its own flex item around the mark.
      const wrap = document.createElement("span")
      const mark = document.createElement("span")
      mark.style.display = "inline-block"
      text.parentNode.insertBefore(wrap, text)
      wrap.append(mark, text)
      const baseline = mark.getBoundingClientRect().bottom - top
      wrap.parentNode?.insertBefore(text, wrap)
      wrap.remove()
      return baseline
    }
    return [...list.querySelectorAll(":scope > dt")].map((term) => ({
      term: term.textContent ?? "",
      termBaseline: baselineOf(term),
      valueBaseline: baselineOf(term.nextElementSibling!),
    }))
  })
}

test.describe("facts", () => {
  for (const [name, args, count] of [
    ["the incident's (copyable ids, retries with their tone's icon)", INCIDENT_ARGS, 4],
    ["the instance's (a state label, counts with their tone's icon)", INSTANCE_ARGS, 4],
  ] as const) {
    test(`${name}: each term on its value's baseline`, async ({ page }) => {
      const app = await openView(page, args)
      const facts = app.locator('[data-slot="facts"]').first()
      await expect(facts).toBeVisible({ timeout: 15_000 })
      const rows = await factBaselines(facts)
      expect(rows.length).toBeGreaterThanOrEqual(count)
      for (const row of rows) {
        expect(
          Math.abs(row.termBaseline - row.valueBaseline),
          `${row.term}: its term and its value on one baseline`,
        ).toBeLessThanOrEqual(0.5)
      }
    })
  }

  test("an alarming count names its alarm in words beside its tone's icon", async ({ page }) => {
    /** The facts' alarming count: the danger icon of its own shape and its words, read after it. */
    const alarmOf = (facts: Locator) =>
      facts.locator('[data-slot="count-figure"][data-tone="danger"]')
    const incident = await openView(page, INCIDENT_ARGS)
    const facts = incident.locator('[data-slot="facts"]').first()
    await expect(facts).toBeVisible({ timeout: 15_000 })
    await expect(alarmOf(facts).locator("svg.lucide-circle-x")).toBeVisible()
    await expect(alarmOf(facts).locator(".sr-only")).toHaveText("No retries left")
    const instance = await openView(page, INSTANCE_ARGS)
    const instanceFacts = instance.locator('[data-slot="facts"]')
    await expect(alarmOf(instanceFacts).locator(".sr-only")).toHaveText("Has open incidents", {
      timeout: 15_000,
    })
    await expect(alarmOf(instanceFacts).locator("svg.lucide-circle-x")).toBeVisible()
  })
})

/** The whole view, the BPMN diagram included: its canvas alone is the image, its controls beside it. */
async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .include("#app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze()
  const violations = results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }))
  expect(violations, label).toEqual([])
}

test.describe("axe on the detail views (WCAG 2.2 A/AA)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`the process, the incident and the instance with a failed refresh, its Details open (${theme})`, async ({
      page,
    }) => {
      const process = await openView(page, PROCESS_ARGS, { theme })
      await expect(process.getByText("Incidents by activity")).toBeVisible({ timeout: 15_000 })
      await expect(process.locator(".djs-container svg").first()).toBeVisible()
      await expectAxeClean(page, `process (${theme})`)

      const incident = await openView(page, INCIDENT_ARGS, { theme })
      await expect(incident.locator('[data-slot="facts"]').first()).toBeVisible({
        timeout: 15_000,
      })
      await expectAxeClean(page, `incident (${theme})`)

      const instance = await openView(page, INSTANCE_ARGS, { theme })
      await expect(instance.getByRole("tab", { selected: true })).toBeVisible({ timeout: 15_000 })
      const strip = await failRefresh(page, instance)
      await strip.getByRole("button", { name: "Details" }).click()
      await expect(strip.getByText("Engine is shutting down")).toBeVisible()
      await expectAxeClean(page, `instance with a failed refresh (${theme})`)
    })
  }
})
