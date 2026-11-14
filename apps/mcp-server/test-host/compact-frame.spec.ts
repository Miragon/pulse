import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import { HEALTHY_ENGINE, REALISTIC_ENGINE, REALISTIC_HOST_ENV } from "./engines.js"

/**
 * The cockpit's frame in the one compact look (D9) where the reader's setup differs from a desk:
 * a touch screen takes the comfortable step, text at 200 % grows every control around it, a
 * 320 px card keeps every fact and id of a view's bar and every section of the head (on its last
 * line where the head wraps), the overview's processes give way to their ellipsis while the row
 * actions scroll, so do a cluster's and the instance list's (its segments one line each), a 400 px chat keeps each incident row one line and each group's title its share
 * and reads a scrolling column's head without a cut word, a narrow card draws the instance's
 * diagram clear of its zoom bar and bpmn.io's link, keeps its tabs one line scrolling in their bar,
 * each job's row one line (a cut error opening on its whole text by keyboard) and the instance
 * search's placeholder whole, every table's row actions
 * sit right-aligned under their head, a footer's noun follows its count, a
 * header's count stays a neutral number beside its tone's icon and its title its share, the head's
 * sections (pulse-ui's NavTabs) open by keyboard, forced colours keep the open tab, the head's
 * open section and a docked strip and draw a tone's icon in its text's system colour, a fact's term sits on its value's baseline, and the detail
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

/** A long engine text, wider than any narrow column: it must stay one line, cut, whole in its title. */
const LONG_MESSAGE =
  "Approver lookup failed: no user with role 'finance-approver' in group 'invoice-eu'"

/** The invoice process's open incidents grouped by activity, each group's page of rows. */
async function groupedIncidents(page: Page) {
  const activities = [
    { activityId: "approveInvoice", activityName: "Approve Invoice", count: 3 },
    { activityId: "chargeCard", activityName: null, count: 1 },
  ].map(({ activityId, activityName, count }) => ({
    activityId,
    activityName,
    representativeMessage: "Approver lookup failed",
    firstSeen: "2026-10-09T08:00:00.000+0000",
    latestIncident: "2026-10-10T08:00:00.000+0000",
    incidentCount: count,
  }))
  const rows = (activityId: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `inc-${activityId}-${index}`,
      processInstanceId: `7f3c2a9${index}-5b0e-4c1d-9a77-2e6b8d4f1c0${index}`,
      businessKey: index === 1 ? null : `INV-2026-00${41 + index}`,
      incidentType: "failedJob",
      incidentMessage: index === 1 ? LONG_MESSAGE : "Approver lookup failed",
      incidentTimestamp: "2026-10-10T08:00:00.000+0000",
      activityId,
      activityName: null,
      recovery: { action: "retry-job", jobId: `job-${index}` },
      cockpitInstanceUrl: null,
    }))
  let definition: Record<string, unknown> | null = null
  const result = (structuredContent: unknown) => ({
    json: { result: { structuredContent, content: [{ type: "text", text: "{}" }] } },
  })
  await page.route("**/host/call", async (route) => {
    const call = route.request().postDataJSON() as {
      name: string
      arguments: Record<string, unknown>
    }
    if (call.name === "engine_open_cockpit") {
      const json = (await (await route.fetch()).json()) as {
        result: { structuredContent: { start: { data: Record<string, unknown> } } }
      }
      const start = json.result.structuredContent.start
      definition = { ...start.data, incidentCount: 4, activities }
      start.data = definition
      return route.fulfill({ json })
    }
    if (call.name === "engine_process_incidents_data" && definition) {
      return route.fulfill(result(definition))
    }
    if (call.name === "engine_activity_incidents_data") {
      const activityId = String(call.arguments.activityId)
      const count = activities.find((a) => a.activityId === activityId)?.incidentCount ?? 0
      return route.fulfill(
        result({
          processDefinitionKey: "invoice",
          activityId,
          incidents: rows(activityId, count),
          totalCount: count,
          engineId: HEALTHY_ENGINE,
        }),
      )
    }
    return route.continue()
  })
}

/** What a narrow incident table shows: its rows, its messages and whether it scrolls in its region. */
async function narrowTable(region: Locator) {
  return region.evaluate((el) => ({
    scrolls: el.scrollWidth > el.clientWidth,
    documentScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    rows: [...el.querySelectorAll("tbody tr")].map((row) =>
      Math.round(row.getBoundingClientRect().height),
    ),
    messages: [...el.querySelectorAll<HTMLElement>("[data-incident-message]")].map((message) => ({
      width: Math.round(message.getBoundingClientRect().width),
      // What the reader sees of it at rest: up to the region's edge or a pinned cell over it.
      visible: Math.round(
        Math.min(
          message.getBoundingClientRect().right,
          el.getBoundingClientRect().right,
          ...[...message.closest("tr")!.children]
            .filter((cell) => getComputedStyle(cell).position === "sticky")
            .map((cell) => cell.getBoundingClientRect().left),
        ) - message.getBoundingClientRect().left,
      ),
      lines: Math.round(message.getBoundingClientRect().height / 20),
      cut: message.scrollWidth > message.clientWidth,
      title: message.title,
    })),
  }))
}

test.describe("the overview's processes in a narrow card", () => {
  for (const width of [320, 400]) {
    test(`at ${width} px the actions scroll with the row and the process gives way with its ellipsis`, async ({
      page,
    }) => {
      const app = await openView(page, { engine: HEALTHY_ENGINE }, { width })
      const region = app.getByRole("region", { name: /^Deployed process definitions/ })
      await expect(region.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
      const rows = await region.locator("tbody tr").evaluateAll((all) =>
        all.map((row) => {
          const name = row.querySelector("td")!
          const actions = row.querySelector("td:last-child")!
          const line = name.querySelector("[title]") as HTMLElement
          return {
            position: getComputedStyle(actions).position,
            overlap: actions.getBoundingClientRect().left < name.getBoundingClientRect().right - 1,
            ellipsis: getComputedStyle(line).textOverflow,
            width: Math.round(line.getBoundingClientRect().width),
          }
        }),
      )
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row).toMatchObject({ position: "static", overlap: false, ellipsis: "ellipsis" })
        expect(row.width, "the process keeps its 8rem floor").toBeGreaterThanOrEqual(120)
      }
      const scrolls = await app
        .locator("html")
        .evaluate((html) => html.scrollWidth > html.clientWidth)
      expect(scrolls, "the document never scrolls sideways").toBe(false)
    })
  }
})

test.describe("a 400 px chat", () => {
  test("the process's incidents by activity: each row one 28 px line, the message cut and whole in its title, the table scrolling in its region; each group's title keeps its share", async ({
    page,
  }) => {
    await groupedIncidents(page)
    const app = await openView(page, PROCESS_ARGS, { width: 400 })
    await expect(app.getByText("Incidents by activity")).toBeVisible({ timeout: 15_000 })
    const groups = app.locator('[role="button"][aria-expanded]')
    await expect(groups).toHaveCount(2)
    // Each group's title beside its count and chevron, 10rem at least, its stats on a line below.
    const summaries = await app.locator('[data-slot="group-summary"]').evaluateAll((all) =>
      all.map((summary) => {
        const title = summary.querySelector('[data-slot="group-summary-title"]')!
        const stats = summary.querySelector('[data-slot="group-summary-stats"]')!
        const count = summary.querySelector('[data-slot="count-badge"]')!
        const box = (el: Element) => el.getBoundingClientRect()
        return {
          title: Math.round(box(title).width),
          titleText: (title.firstElementChild as HTMLElement).innerText,
          titleWhole:
            title.firstElementChild!.firstElementChild!.scrollWidth <=
            title.firstElementChild!.firstElementChild!.clientWidth,
          statsBelow: box(stats).top >= box(title).bottom - 1,
          countBeside: Math.abs(box(count).top - box(title).top) < box(title).height,
        }
      }),
    )
    expect(summaries.map((s) => s.titleText)).toEqual(["Approve Invoice", "chargeCard"])
    for (const summary of summaries) {
      expect(summary.title, `${summary.titleText}: the title's share`).toBeGreaterThanOrEqual(160)
      expect(summary).toMatchObject({ titleWhole: true, statsBelow: true, countBeside: true })
    }
    await groups.first().click()
    const region = app.getByRole("region", { name: "Incidents in this activity" })
    await expect(region.locator("tbody tr")).toHaveCount(3, { timeout: 15_000 })
    const seen = await narrowTable(region)
    expect(seen.rows).toEqual([28, 28, 28])
    expect(seen.scrolls, "the table scrolls in its region").toBe(true)
    expect(seen.documentScrolls, "the document never scrolls sideways").toBe(false)
    expect(seen.messages).toHaveLength(3)
    for (const message of seen.messages) {
      expect(message.width, "a message keeps 10rem").toBeGreaterThanOrEqual(160)
      expect(message.visible, "its 10rem in view at rest").toBeGreaterThanOrEqual(160)
      expect(message.lines).toBe(1)
    }
    expect(seen.messages[1]).toMatchObject({ cut: true, title: LONG_MESSAGE })
    // An instance with a business key shows the key alone here, its id in the title and read out.
    const label = region.locator("tbody tr").first().locator("td").first()
    await expect(label).toContainText("INV-2026-0041")
    await expect(label.getByRole("button", { name: /^Copy/ })).toBeHidden()
  })

  test("an activity's incidents: the actions' head is read, not cut at the edge, while the actions scroll; the footer's noun follows its count", async ({
    page,
  }) => {
    await groupedIncidents(page)
    const app = await openView(page, PROCESS_ARGS, { width: 400 })
    const groups = app.locator('[role="button"][aria-expanded]')
    await expect(groups).toHaveCount(2, { timeout: 15_000 })
    await groups.first().click()
    const region = app.getByRole("region", { name: "Incidents in this activity" })
    await expect(region.locator("tbody tr")).toHaveCount(3, { timeout: 15_000 })
    const head = region.getByRole("columnheader", { name: "Actions" })
    await expect(head).toHaveCount(1)
    const word = await head.locator("[data-list-table-scrolls]").evaluate((el) => {
      const box = el.getBoundingClientRect()
      return { width: box.width, height: box.height, clip: getComputedStyle(el).clipPath }
    })
    expect(word, "the head's word visually hidden while the actions scroll").toEqual({
      width: 1,
      height: 1,
      clip: "inset(50%)",
    })
    await expect(app.getByText("Showing 3 of 3 incidents")).toBeVisible()
    await groups.nth(1).click()
    await expect(app.getByText("Showing 1 of 1 incident", { exact: true })).toBeVisible({
      timeout: 15_000,
    })
  })

  test("an instance's incidents: each row one 28 px line, the message 10rem at least, the document never scrolling sideways", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCE_ARGS, { width: 400 })
    await app
      .getByRole("tab", { name: /^Incidents/ })
      .first()
      .click({ timeout: 15_000 })
    const region = app.getByRole("region", { name: "Incidents of this instance" })
    await expect(region.locator("tbody tr")).toHaveCount(2, { timeout: 15_000 })
    const seen = await narrowTable(region)
    expect(seen.rows).toEqual([28, 28])
    expect(seen.documentScrolls).toBe(false)
    for (const message of seen.messages) {
      expect(message.width).toBeGreaterThanOrEqual(160)
      expect(message.visible, "its 10rem in view at rest").toBeGreaterThanOrEqual(160)
      expect(message.lines).toBe(1)
    }
    expect(seen.messages.map((message) => message.title)).toEqual([
      "Approver lookup failed",
      "Card declined",
    ])
  })
})

/** A failure cluster of three instances across two processes, each with its incident. */
const CLUSTER = {
  activityId: "chargeCard",
  activityName: "Charge card",
  incidentType: "failedJob",
  messageSignature: "card declined by <id>",
  incidentCount: 3,
  scannedIncidentCount: 3,
  lastHourCount: 1,
  last24hCount: 2,
  firstSeen: "2026-10-09T08:00:00.000+0000",
  latestIncident: "2026-10-10T08:00:00.000+0000",
  processDefinitionKeys: ["invoice", "onboarding"],
  representativeMessage: "Card declined by the payment provider",
  incidents: [1, 2, 3].map((index) => ({
    incidentId: `inc-c-${index}`,
    processInstanceId: `7f3c2a9${index}-5b0e-4c1d-9a77-2e6b8d4f1c0${index}`,
    businessKey: index === 2 ? null : `INV-2026-00${40 + index}`,
    processDefinitionKey: index === 3 ? "onboarding" : "invoice",
    processDefinitionName: index === 3 ? "Customer Onboarding" : "Invoice Receipt",
    incidentTimestamp: "2026-10-10T08:00:00.000+0000",
  })),
  totalMatching: 3,
  engineId: HEALTHY_ENGINE,
  fetchedAt: "2026-10-10T08:05:00.000Z",
}
const CLUSTER_ARGS = {
  engine: HEALTHY_ENGINE,
  view: "cluster-detail",
  activityId: "chargeCard",
  incidentType: "failedJob",
}

async function cluster(page: Page) {
  await page.route("**/host/call", async (route) => {
    const call = route.request().postDataJSON() as { name: string }
    if (call.name === "engine_open_cockpit") {
      const json = (await (await route.fetch()).json()) as {
        result: { structuredContent: { start: { data: Record<string, unknown> } } }
      }
      const start = json.result.structuredContent.start
      start.data = { ...start.data, ...CLUSTER }
      return route.fulfill({ json })
    }
    if (call.name === "engine_cluster_detail_data") {
      return route.fulfill({
        json: { result: { structuredContent: CLUSTER, content: [{ type: "text", text: "{}" }] } },
      })
    }
    return route.continue()
  })
}

test.describe("a cluster's affected instances", () => {
  for (const width of [760, 400]) {
    test(`at ${width} px the table fits its region, no column under the actions`, async ({
      page,
    }) => {
      await cluster(page)
      const app = await openView(page, CLUSTER_ARGS, { width })
      const region = app.getByRole("region", { name: "Affected instances" }).last()
      await expect(region.locator("tbody tr")).toHaveCount(3, { timeout: 15_000 })
      const seen = await region.evaluate((el) => {
        const head = [...el.querySelectorAll("thead th")]
        const pinned = head.at(-1)!.getBoundingClientRect().left
        return {
          scrolls: el.scrollWidth > el.clientWidth,
          covered: head
            .slice(0, -1)
            .filter((cell) => getComputedStyle(cell).display !== "none")
            .filter((cell) => cell.getBoundingClientRect().right > pinned + 1)
            .map((cell) => (cell as HTMLElement).innerText),
        }
      })
      expect(seen).toEqual({ scrolls: false, covered: [] })
    })
  }
})

/** A narrow table's rows: whether the actions are pinned, cover the first cell, or cut a text. */
async function narrowRows(region: Locator) {
  return region.evaluate((el) => ({
    head: [...el.querySelectorAll("thead th")].map((th) => {
      const word = th.querySelector("[data-list-table-scrolls]")
      return { name: th.textContent, inSight: word ? word.getBoundingClientRect().width > 1 : true }
    }),
    documentScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    rows: [...el.querySelectorAll("tbody tr")].map((row) => {
      const first = row.querySelector("td")!
      const actions = row.querySelector("td:last-child")!
      return {
        subject: first.textContent,
        position: getComputedStyle(actions).position,
        overlap: actions.getBoundingClientRect().left < first.getBoundingClientRect().right - 1,
        cut: [...first.querySelectorAll<HTMLElement>("*")]
          .filter((part) => part.children.length === 0 && part.textContent)
          .filter((part) => part.scrollWidth > part.clientWidth + 1)
          .map((part) => part.textContent),
      }
    }),
  }))
}

test.describe("a 320 px card's tables", () => {
  test("a cluster's actions scroll with the row: every business key whole, the actions head read only", async ({
    page,
  }) => {
    await cluster(page)
    const app = await openView(page, CLUSTER_ARGS, { width: 320 })
    const region = app.getByRole("region", { name: "Affected instances" }).last()
    // The inline card shows the rows that fit its height; the first is a business key.
    await expect(region.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    await expect(region.getByRole("columnheader", { name: "Actions" })).toBeAttached()
    const seen = await narrowRows(region)
    expect(seen.documentScrolls, "the document never scrolls sideways").toBe(false)
    expect(seen.head.at(-1), "the head's word, for a screen reader alone").toEqual({
      name: "Actions",
      inSight: false,
    })
    for (const row of seen.rows) {
      expect(row).toMatchObject({ position: "static", overlap: false })
      // Only the quiet id beside a business key may give way to its ellipsis (NamedId).
      expect(row.cut.filter((text) => text?.includes("INV-"))).toEqual([])
    }
    expect(seen.rows[0]?.subject).toContain("INV-2026-0041")
  })

  test("the instance list: one-line segments, its region named once, the actions after the state", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCES_ARGS, { hostEnv: REALISTIC_HOST_ENV, width: 320 })
    const region = app.getByRole("region", { name: "Running instances", exact: true })
    await expect(region.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    const segments = await app
      .getByRole("radiogroup", { name: "Show instances" })
      .getByRole("radio")
      .evaluateAll((all) =>
        all.map((segment) => ({
          name: segment.textContent,
          height: Math.round(segment.getBoundingClientRect().height),
        })),
      )
    expect(segments.map((segment) => segment.name)).toEqual([
      expect.stringMatching(/^All/),
      expect.stringMatching(/^With incident/),
      expect.stringMatching(/^Suspended/),
    ])
    // A segment keeps the density's 24 px on one line; where the group has no room a whole
    // segment wraps, never its words.
    for (const segment of segments) expect(segment.height, segment.name ?? "").toBe(24)
    const seen = await narrowRows(region)
    expect(seen.documentScrolls, "the document never scrolls sideways").toBe(false)
    for (const row of seen.rows) {
      expect(row).toMatchObject({ position: "static", overlap: false })
    }
    const states = await region.evaluate((el) => {
      const right = el.getBoundingClientRect().right
      return [...el.querySelectorAll("tbody tr td:nth-child(2) [data-slot='state-label']")]
        .filter((label) => label.getAttribute("data-state") !== "incident")
        .map((label) => label.getBoundingClientRect().right <= right)
    })
    expect(states.length).toBeGreaterThan(0)
    expect(new Set(states), "every row's state in view, nothing over it").toEqual(new Set([true]))
  })
})

/** `group` is what a row's last cell holds its actions in: a group of them, or its one button. */
async function actionsHeadOverButtons(region: Locator, group = "div") {
  return region.evaluate((el, group) => {
    const head = [...el.querySelectorAll("thead th")].at(-1)!
    const range = document.createRange()
    range.selectNodeContents(head)
    const groups = [...el.querySelectorAll(`tbody tr td:last-child > ${group}`)]
    return {
      head: head.textContent,
      align: getComputedStyle(head).textAlign,
      word: Math.round(range.getBoundingClientRect().right),
      buttons: [...new Set(groups.map((group) => Math.round(group.getBoundingClientRect().right)))],
    }
  }, group)
}

test.describe("a 760 px card's action heads", () => {
  test("a cluster's actions head sits over its buttons, right-aligned like them", async ({
    page,
  }) => {
    await cluster(page)
    const app = await openView(page, CLUSTER_ARGS, { width: 760 })
    const region = app.getByRole("region", { name: "Affected instances" }).last()
    await expect(region.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    const seen = await actionsHeadOverButtons(region)
    expect(seen).toMatchObject({ head: "Actions", align: "right" })
    expect(seen.buttons).toEqual([seen.word])
  })

  test("the instance list's actions head sits over its buttons, every row's group ending at one edge", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCES_ARGS, { hostEnv: REALISTIC_HOST_ENV, width: 760 })
    const region = app.getByRole("region", { name: "Running instances", exact: true })
    await expect(region.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    const seen = await actionsHeadOverButtons(region)
    expect(seen).toMatchObject({ head: "Actions", align: "right" })
    expect(seen.buttons).toEqual([seen.word])
  })

  test("the overview's processes and the jobs name their actions head, over their buttons", async ({
    page,
  }) => {
    const views = [
      { args: { engine: HEALTHY_ENGINE }, region: /^Deployed process definitions/ },
      { args: { engine: HEALTHY_ENGINE, view: "jobs" }, region: /^Jobs$/ },
    ]
    for (const view of views) {
      const app = await openView(page, view.args, { width: 760 })
      const region = app.getByRole("region", { name: view.region })
      await expect(region.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
      await expect(region.getByRole("columnheader", { name: "Actions" })).toHaveCount(1)
      const seen = await actionsHeadOverButtons(region)
      expect(seen).toMatchObject({ head: "Actions", align: "right" })
      expect(seen.buttons).toEqual([seen.word])
    }
  })

  test("the incident tables' actions head sits over their buttons, right-aligned like every table's", async ({
    page,
  }) => {
    await groupedIncidents(page)
    const process = await openView(page, PROCESS_ARGS, { width: 760 })
    const groups = process.locator('[role="button"][aria-expanded]')
    await expect(groups).toHaveCount(2, { timeout: 15_000 })
    await groups.first().click()
    const byActivity = process.getByRole("region", { name: "Incidents in this activity" })
    await expect(byActivity.locator("tbody tr")).toHaveCount(3, { timeout: 15_000 })
    const activity = await actionsHeadOverButtons(byActivity)
    expect(activity).toMatchObject({ head: "Actions", align: "right" })
    expect(activity.buttons).toEqual([activity.word])

    const instance = await openView(page, INSTANCE_ARGS, { width: 760 })
    await instance
      .getByRole("tab", { name: /^Incidents/ })
      .first()
      .click({ timeout: 15_000 })
    const ofInstance = instance.getByRole("region", { name: "Incidents of this instance" })
    await expect(ofInstance.locator("tbody tr")).toHaveCount(2, { timeout: 15_000 })
    const own = await actionsHeadOverButtons(ofInstance)
    expect(own).toMatchObject({ head: "Actions", align: "right" })
    expect(own.buttons).toEqual([own.word])
  })

  test("an instance's variables name their edit column's head where the deployment offers the edit", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCE_ARGS, {
      hostEnv: "HOST_SIM_OPERATIONS_URL",
      width: 760,
    })
    await app
      .getByRole("tab", { name: /^Variables/ })
      .first()
      .click({ timeout: 15_000 })
    const region = app.getByRole("region", { name: "Process instance variables" })
    await expect(region.getByRole("button", { name: "Edit" }).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(region.getByRole("columnheader", { name: "Actions" })).toHaveCount(1)
    const seen = await actionsHeadOverButtons(region, "button")
    expect(seen).toMatchObject({ head: "Actions", align: "right" })
    expect(seen.buttons).toEqual([seen.word])
  })
})

test.describe("a table's heads, a guard for when the cockpit sizes its columns", () => {
  test("the instance list names each head by its caption alone, as the editors name their sized heads (no cockpit head has a grip or a column menu today)", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCES_ARGS, { hostEnv: REALISTIC_HOST_ENV, width: 760 })
    const table = app.getByRole("table", { name: "Running instances", exact: true })
    await expect(table.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    const captions = await table
      .locator("thead tr:last-child > th")
      .evaluateAll((heads) => heads.map((head) => (head.textContent ?? "").trim()).filter(Boolean))
    expect(captions.length).toBeGreaterThan(2)
    for (const caption of captions) {
      await expect(table.getByRole("columnheader", { name: caption, exact: true })).toHaveCount(1)
    }
  })
})

test.describe("a view's header counts", () => {
  test("the process's open incidents: a state label, the number in the foreground on no tint", async ({
    page,
  }) => {
    await groupedIncidents(page)
    const app = await openView(page, PROCESS_ARGS)
    const state = app.locator('[data-slot="view-bar"] [data-slot="state-label"]')
    await expect(state).toHaveText("4 open incidents", { timeout: 15_000 })
    const seen = await state.evaluate((label) => {
      const words = label.lastElementChild!
      return {
        words: getComputedStyle(words).color,
        foreground: getComputedStyle(document.body).color,
        fill: getComputedStyle(label).backgroundColor,
        icon: getComputedStyle(label.querySelector("svg")!).color,
        shape: label.querySelector("svg")!.getAttribute("class"),
      }
    })
    expect(seen.words).toBe(seen.foreground)
    expect(seen.fill).toBe("rgba(0, 0, 0, 0)")
    expect(seen.shape).toContain("lucide-circle-x")
    expect(seen.icon).not.toBe(seen.foreground)
  })

  test("at 760 px the title keeps its share beside the count, whole, and no fact is cut", async ({
    page,
  }) => {
    await groupedIncidents(page)
    const app = await openView(page, PROCESS_ARGS)
    const bar = app.locator('[data-slot="view-bar"]').first()
    await expect(bar.locator('[data-slot="state-label"]')).toBeVisible({ timeout: 15_000 })
    const seen = await bar.evaluate((el) => {
      const title = el.querySelector("h1 > span")!
      const facts = [...el.querySelectorAll('[data-slot="view-bar-facts"] *')].filter(
        (part) => part.children.length === 0 && part.textContent,
      )
      return {
        whole: title.scrollWidth <= title.clientWidth,
        cutFacts: facts.filter((part) => part.scrollWidth > part.clientWidth + 1).length,
      }
    })
    expect(seen).toEqual({ whole: true, cutFacts: 0 })
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

  for (const width of [320, 400]) {
    test(`a ${width} px card keeps every section whole and inside it, on the head's last line, the open one's bar on its rule`, async ({
      page,
    }) => {
      const app = await openView(page, { engine: HEALTHY_ENGINE }, { width })
      const sections = app.getByRole("navigation", { name: "Cockpit sections" })
      await expect(sections.getByRole("button", { name: "Overview" })).toBeVisible({
        timeout: 15_000,
      })
      const seen = await sections.evaluate((nav) => {
        const width = document.documentElement.clientWidth
        const head = nav.closest('[data-slot="cockpit-head"]')!.getBoundingClientRect()
        const context = nav
          .closest('[data-slot="cockpit-head"]')!
          .querySelector('[data-slot="engine-context"]')!
          .getBoundingClientRect()
        const items = [...nav.querySelectorAll("button")].map((item) => {
          const box = item.getBoundingClientRect()
          return {
            name: item.textContent,
            inside: box.left >= 0 && box.right <= width,
            whole: item.scrollWidth <= item.clientWidth,
            // The head wraps here: the sections stay on its last line, each reaching its rule.
            onTheRule: Math.round(box.bottom) === Math.round(head.bottom),
          }
        })
        return {
          items,
          scrolls: document.documentElement.scrollWidth > width,
          contextAbove: context.bottom <= nav.getBoundingClientRect().top + 1,
        }
      })
      expect(seen.scrolls, "the document never scrolls sideways").toBe(false)
      expect(seen.contextAbove, "the engine's context on the line above the sections").toBe(true)
      expect(seen.items.map((item) => item.name)).toEqual(["Overview", "Incidents", "Jobs"])
      for (const item of seen.items) {
        expect(item, `${item.name} whole, inside the card and on the head's rule`).toEqual({
          name: item.name,
          inside: true,
          whole: true,
          onTheRule: true,
        })
      }
    })
  }
})

/**
 * Where the instance's diagram lies on its canvas and what lies over it: each drawn element (a
 * shape, a flow, a label) against the zoom bar and bpmn.io's link, and the drawing's extent.
 */
async function diagramLayout(app: FrameLocator) {
  return app.locator("html").evaluate((html) => {
    const canvas = html.querySelector(".djs-container")!.getBoundingClientRect()
    const over = {
      "the zoom bar": html.querySelector('[data-slot="bpmn-zoom-controls"]')!,
      "bpmn.io's link": html.querySelector(".bjs-powered-by")!,
    }
    const drawn = [...html.querySelectorAll(".djs-element:not(.djs-root) > .djs-visual")].map(
      (visual) => ({
        id: visual.parentElement!.getAttribute("data-element-id"),
        box: visual.getBoundingClientRect(),
      }),
    )
    const meets = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const left = Math.min(...drawn.map(({ box }) => box.left))
    const right = Math.max(...drawn.map(({ box }) => box.right))
    return {
      elements: drawn.length,
      covered: Object.entries(over).flatMap(([name, el]) =>
        drawn
          .filter(({ box }) => meets(box, el.getBoundingClientRect()))
          .map(({ id }) => `${id} under ${name}`),
      ),
      outside: drawn
        .filter(
          ({ box }) =>
            box.left < canvas.left ||
            box.right > canvas.right ||
            box.top < canvas.top ||
            box.bottom > canvas.bottom,
        )
        .map(({ id }) => id),
      share: (right - left) / canvas.width,
      gaps: { left: left - canvas.left, right: canvas.right - right },
    }
  })
}

/** The instance's diagram, drawn and fitted to its frame (the fit follows the drawn bounds). */
async function fittedDiagram(app: FrameLocator) {
  await expect(app.locator("g.djs-element").first()).toBeVisible({ timeout: 15_000 })
  await expect(app.locator(".bjs-powered-by")).toBeVisible()
  await expect
    .poll(() =>
      app.locator(".djs-container svg .viewport").evaluate(async (viewport) => {
        const before = viewport.getAttribute("transform")
        await new Promise((resolve) => setTimeout(resolve, 150))
        return before !== null && before === viewport.getAttribute("transform")
      }),
    )
    .toBe(true)
}

test.describe("a narrow card's details", () => {
  for (const width of [320, 400]) {
    test(`at ${width} px the instance's diagram lies clear of the zoom bar and bpmn.io's link, whole on its canvas`, async ({
      page,
    }) => {
      const app = await openView(page, INSTANCE_ARGS, { width })
      await fittedDiagram(app)
      const seen = await diagramLayout(app)
      expect(seen.elements, "the invoice diagram drawn").toBeGreaterThan(10)
      expect(seen.covered, "nothing under the zoom bar or the link").toEqual([])
      expect(seen.outside, "every element on the canvas").toEqual([])
      // The room left of the bar and above the link still holds it across most of the width.
      expect(seen.share, "the drawing's share of the canvas's width").toBeGreaterThanOrEqual(0.7)
    })

    test(`at ${width} px each job's row is one 28 px line: its error cut with an ellipsis, whole in its title, a cut one a disclosure`, async ({
      page,
    }) => {
      const app = await openView(page, { engine: HEALTHY_ENGINE, view: "jobs" }, { width })
      const region = app.getByRole("region", { name: /^Jobs$/ })
      // The rows that fit the host's height, as many as its footer says.
      const footer = app.getByText(/^Showing \d+ of 16 jobs$/)
      await expect(footer).toBeVisible({ timeout: 15_000 })
      const shown = Number((await footer.innerText()).split(" ")[1])
      await expect(region.locator("tbody tr")).toHaveCount(shown)
      const seen = await region.evaluate((el) => ({
        rows: [
          ...new Set(
            [...el.querySelectorAll("tbody tr")].map((row) => row.getBoundingClientRect().height),
          ),
        ],
        errors: [...el.querySelectorAll<HTMLElement>("tbody tr td:nth-child(4) [title]")].map(
          (error) => ({
            whole: error.title === error.textContent,
            lines: Math.round(error.getBoundingClientRect().height / 20),
            cut: error.scrollWidth > error.clientWidth,
            disclosure: error.tagName === "SUMMARY",
            width: Math.round(error.getBoundingClientRect().width),
          }),
        ),
      }))
      expect(seen.rows, "every row at the row height").toEqual([28])
      expect(seen.errors).toHaveLength(shown)
      for (const error of seen.errors) {
        expect(error).toMatchObject({ whole: true, lines: 1 })
        expect(error.width, "an error keeps 10rem").toBeGreaterThanOrEqual(160)
        expect(error.disclosure, "a cut error opens, a whole one does not").toBe(error.cut)
      }
      expect(
        seen.errors.some((error) => error.cut),
        "a longer error is cut",
      ).toBe(true)
      expect(
        seen.errors.some((error) => !error.cut),
        "a short error shows whole",
      ).toBe(true)
    })
  }

  test("at 400 px a job's cut error opens on its whole text by keyboard, its row back at 28 px once closed", async ({
    page,
  }) => {
    const app = await openView(page, { engine: HEALTHY_ENGINE, view: "jobs" }, { width: 400 })
    const region = app.getByRole("region", { name: /^Jobs$/ })
    await expect(app.getByText(/^Showing \d+ of 16 jobs$/)).toBeVisible({ timeout: 15_000 })
    const rows = region.locator("tbody tr")
    const index = await rows.evaluateAll((all) =>
      all.findIndex((row) => row.querySelector("td:nth-child(4) summary")),
    )
    expect(index, "a cut error").toBeGreaterThanOrEqual(0)
    const row = rows.nth(index)
    const error = row.locator("td:nth-child(4) summary")
    const whole = (await error.getAttribute("title"))!
    const height = () => row.evaluate((tr) => tr.getBoundingClientRect().height)

    await error.focus()
    await page.keyboard.press("Enter")
    const text = row.locator("td:nth-child(4) pre")
    await expect(text).toBeVisible()
    await expect(text).toHaveText(whole)
    expect(await height(), "the open error grows its row").toBeGreaterThan(28)

    await page.keyboard.press("Enter")
    await expect(text).toBeHidden()
    await expect.poll(height).toBe(28)
    await expect(error, "still a disclosure, its line still cut").toHaveCount(1)
  })

  test("at 760 px the instance's diagram keeps bpmn-js's own fit, centred, where nothing lies over it", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCE_ARGS, { width: 760 })
    await fittedDiagram(app)
    const seen = await diagramLayout(app)
    expect(seen.covered).toEqual([])
    expect(Math.abs(seen.gaps.left - seen.gaps.right), "centred").toBeLessThanOrEqual(2)
  })

  test("at 320 px the instance's tabs stay one line in their bar and scroll inside it; the arrows reach each and show it whole", async ({
    page,
  }) => {
    const app = await openView(page, INSTANCE_ARGS, { width: 320 })
    const tabs = app.getByRole("tab")
    await expect(tabs).toHaveCount(4, { timeout: 15_000 })
    const seen = await app.getByRole("tablist").evaluate((list) => ({
      lines: new Set(
        [...list.querySelectorAll('[role="tab"]')].map((tab) =>
          Math.round(tab.getBoundingClientRect().top),
        ),
      ).size,
      bar: Math.round(list.parentElement!.getBoundingClientRect().height),
      scrolls: list.scrollWidth > list.clientWidth,
      documentScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }))
    expect(seen).toEqual({ lines: 1, bar: 36, scrolls: true, documentScrolls: false })

    await tabs.first().focus()
    for (const name of [/^Incidents/, /^Variables/, /^History/]) {
      await page.keyboard.press("ArrowRight")
      await expect(app.getByRole("tab", { name })).toBeFocused()
    }
    const history = await app.getByRole("tablist").evaluate((list) => {
      const shown = list.getBoundingClientRect()
      const tab = list.querySelector('[role="tab"]:focus')!.getBoundingClientRect()
      return {
        whole: tab.left >= shown.left && tab.right <= shown.right,
        scrolled: list.scrollLeft > 0,
      }
    })
    expect(history).toEqual({ whole: true, scrolled: true })
    await expect(app.getByRole("tab", { name: /^History/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  for (const width of [760, 400]) {
    test(`at ${width} px the instance list's search shows its placeholder whole, the words its name starts with`, async ({
      page,
    }) => {
      const app = await openView(page, INSTANCES_ARGS, { hostEnv: REALISTIC_HOST_ENV, width })
      const search = app.getByRole("searchbox", { name: "Search instances by business key or ID" })
      await expect(search).toBeVisible({ timeout: 15_000 })
      await expect(search).toHaveAttribute("placeholder", "Search instances…")
      const fit = await search.evaluate((input: HTMLInputElement) => {
        const style = getComputedStyle(input)
        const pen = document.createElement("canvas").getContext("2d")!
        pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const room =
          input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        return { text: pen.measureText(input.placeholder).width, room }
      })
      expect(fit.text, "the placeholder whole in the field").toBeLessThanOrEqual(fit.room)
    })
  }
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

  for (const [name, args, prepare, hostEnv] of [
    ["a cluster's KPI tile", CLUSTER_ARGS, cluster, "HOST_SIM_URL"],
    [
      "the process's header state and its groups' pills",
      PROCESS_ARGS,
      groupedIncidents,
      "HOST_SIM_URL",
    ],
    ["the instance list's states and scope count", INSTANCES_ARGS, null, REALISTIC_HOST_ENV],
  ] as const) {
    test(`${name}: a tone's icon takes its text's system colour, never its tone`, async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: "active" })
      if (prepare) await prepare(page)
      const app = await openView(page, args, { hostEnv })
      const toned = app.locator(
        ':is([data-slot="count-figure"], [data-slot="count-badge"], [data-slot="state-label"], [data-slot="segmented-option"]) svg[class*="text-danger"]',
      )
      await expect(toned.first()).toBeVisible({ timeout: 15_000 })
      const seen = await toned.evaluateAll((icons) => {
        const colour = (value: string) => {
          const probe = document.createElement("i")
          probe.style.color = value
          document.body.append(probe)
          const computed = getComputedStyle(probe).color
          probe.remove()
          return computed
        }
        const system = [colour("CanvasText"), colour("ButtonText")]
        return icons.map((icon) => {
          const own = getComputedStyle(icon).color
          return {
            follows: own === getComputedStyle(icon.parentElement!).color,
            system: system.includes(own),
          }
        })
      })
      expect(seen.length).toBeGreaterThan(0)
      for (const icon of seen) expect(icon).toEqual({ follows: true, system: true })
    })
  }

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
