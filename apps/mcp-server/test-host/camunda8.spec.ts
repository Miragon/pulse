import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import { c8Requests, LONG_ORDER_KEY } from "./c8-engine.js"
import {
  C8_CONTROL_ENV,
  C8_ENGINE,
  C8_OPERATE,
  C8_UNBOARDED_ENGINE,
  CAMUNDA8_HOST_ENV,
  HEALTHY_ENGINE,
  ORDERS_BOARD,
} from "./engines.js"

/**
 * Camunda 8 in the BUILT bundle: the server reads a Camunda 8 engine on boards only. The
 * deployment (global-setup.ts) sets the stub engine beside a loopback Camunda 8 cluster
 * (c8-engine.ts) under two profiles of the client credentials grant: `c8-orders`, which the board
 * `orders` names and whose profile names its Operate, and `c8-billing`, which no board names. The
 * landing lists both and asks neither cluster anything, counted at the cluster; each opens the
 * cockpit's one state for such an engine, the gate, in its variant (the boards that name it and
 * its Operate, or that none does yet), which reads nothing either and shows none of the sections
 * of an engine above it. The board shows the cluster's numbers, its instances by keys of 16 to 19
 * digits and its Zeebe diagram; no view of the cockpit reads a Camunda 8 engine, so its tiles'
 * rows, counts and diagram and its chip open nothing. Dark, forced colours, axe.
 * The scenarios run one after another, since the landing's and the gate's count the cluster's
 * requests, which the board's would add to.
 */

test.describe.configure({ mode: "default" })

interface Scenario {
  args?: Record<string, unknown>
  theme?: "light" | "dark"
  locale?: string
  width?: number
}

interface HostLog {
  originalResult: { content?: { type: string; text?: string }[] } | null
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
}

const BOARD_ARGS = { view: "board", board: ORDERS_BOARD }
const TITLE = "Order operations"

function envOf(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is unset. Run via \`playwright test -c test-host\``)
  return value
}

async function openCockpit(page: Page, scenario: Scenario = {}): Promise<FrameLocator> {
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify(scenario.args ?? {}),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme: scenario.theme ?? "light",
    locale: scenario.locale ?? "en-US",
    width: String(scenario.width ?? 960),
    maxHeight: "2000",
  })
  await page.goto(`${envOf(CAMUNDA8_HOST_ENV)}/?${query.toString()}`)
  return page.frameLocator("#app")
}

async function hostLog(page: Page): Promise<HostLog> {
  return await page.evaluate(() => (window as unknown as { __hostLog: HostLog }).__hostLog)
}

/** What the cluster was asked since the last forget; `forget` clears it. */
const asked = (forget = false) => c8Requests(envOf(C8_CONTROL_ENV), forget)

/** The tool calls the view made for a Camunda 8 engine. */
async function callsForCamunda8(page: Page) {
  const named = [C8_ENGINE, C8_UNBOARDED_ENGINE]
  return (await hostLog(page)).toolCalls.filter((call) =>
    named.includes(String(call.arguments.engine)),
  )
}

const landing = (app: FrameLocator) =>
  app.getByRole("heading", { level: 1, name: "Operations Cockpit" })
const engineRow = (app: FrameLocator, name: string | RegExp) =>
  app.getByRole("region", { name: "Engines" }).getByRole("button", { name })
const gate = (app: FrameLocator, engine: string) =>
  app.getByRole("heading", { level: 1, name: `${engine} is a Camunda 8 engine` })
const boardHeading = (app: FrameLocator) => app.getByRole("heading", { level: 1, name: TITLE })
const tile = (app: FrameLocator, name: string) => app.getByRole("region", { name })
const trail = (app: FrameLocator) => app.getByRole("navigation", { name: "Breadcrumb" })

/** The board has drawn: its title, and the Zeebe diagram on the canvas. */
async function drawn(app: FrameLocator): Promise<void> {
  await expect(boardHeading(app)).toBeVisible({ timeout: 15_000 })
  await expect(app.locator(".djs-container svg").first()).toBeVisible({ timeout: 15_000 })
}

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

/** The colour a system colour keyword computes to in the view's frame. */
async function systemColour(locator: Locator, name: string): Promise<string> {
  return await locator.evaluate((_el, keyword) => {
    const probe = document.createElement("i")
    probe.style.color = keyword
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, name)
}

/** The computed `color` of every element the locator matches, in document order. */
async function coloursOf(locator: Locator): Promise<string[]> {
  return await locator.evaluateAll((els) => els.map((el) => getComputedStyle(el).color))
}

/** Relative luminance (0 = black, 1 = white) of an element's computed background. */
async function backgroundLuminance(locator: Locator): Promise<number> {
  return await locator.evaluate((el) => {
    // A canvas normalizes any CSS colour syntax (color(srgb …), oklch …) to sRGB bytes.
    const ctx = document.createElement("canvas").getContext("2d")!
    ctx.fillStyle = getComputedStyle(el).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  })
}

test.describe("Camunda 8 on the landing and in the gate", () => {
  test("the landing lists both Camunda 8 engines beside the stub and asks neither anything", async ({
    page,
  }) => {
    await asked(true)
    const app = await openCockpit(page)
    await expect(landing(app)).toBeVisible({ timeout: 15_000 })
    await expect(app.getByRole("region", { name: "Engines" }).getByRole("button")).toHaveCount(3)
    await expect(engineRow(app, `${C8_ENGINE} , Camunda 8, on boards`)).toBeVisible()
    await expect(
      engineRow(app, `${C8_UNBOARDED_ENGINE} , Camunda 8, on no board yet`),
    ).toBeVisible()
    // The stub's row has its verdict: its reads are done, and none went to a Camunda 8 engine.
    await expect(engineRow(app, new RegExp(`^${HEALTHY_ENGINE} , `))).not.toHaveAttribute(
      "aria-busy",
      "true",
    )
    await expect
      .poll(async () => (await hostLog(page)).toolCalls.map((call) => call.name))
      .toContain("engine_health_data")
    expect(await callsForCamunda8(page)).toEqual([])
    expect(await asked()).toEqual([])
  })

  test("a Camunda 8 engine a board names: the gate names its board and its Operate, reads nothing, and the board opens", async ({
    page,
  }) => {
    const app = await openCockpit(page)
    await asked(true)
    await engineRow(app, new RegExp(`^${C8_ENGINE} , `)).click()
    await expect(gate(app, C8_ENGINE)).toBeVisible()
    // No section of an engine serves its dialect: no tab above it, its trail names the engine.
    await expect(app.getByRole("navigation", { name: "Cockpit sections" })).toHaveCount(0)
    await expect(trail(app).getByRole("button")).toHaveText(["All engines"])
    await expect(trail(app).getByText(C8_ENGINE, { exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(
      app.getByText("Pulse shows it here on boards: open one that names it."),
    ).toBeVisible()
    const boards = app.getByRole("list", { name: `Boards that name ${C8_ENGINE}` })
    await expect(boards.getByRole("button")).toHaveCount(1)
    const operate = app.getByRole("link", { name: "Open in Operate (opens in a new tab)" })
    await expect(operate).toHaveAttribute("href", C8_OPERATE)
    expect(await callsForCamunda8(page)).toEqual([])
    expect(await asked()).toEqual([])

    await boards.getByRole("button", { name: new RegExp(`^${TITLE}`) }).click()
    await drawn(app)
  })

  test("a Camunda 8 engine no board names: the gate says so, offers no Operate, and leads back", async ({
    page,
  }) => {
    const app = await openCockpit(page)
    await asked(true)
    await engineRow(app, new RegExp(`^${C8_UNBOARDED_ENGINE} , `)).click()
    await expect(gate(app, C8_UNBOARDED_ENGINE)).toBeVisible()
    await expect(
      app.getByText(
        "Pulse shows it here on boards only, and no board names it yet. Ask whoever runs this Pulse server to add one.",
      ),
    ).toBeVisible()
    await expect(app.getByRole("list", { name: /^Boards that name/ })).toHaveCount(0)
    await expect(app.getByRole("link", { name: /Operate/ })).toHaveCount(0)
    expect(await asked()).toEqual([])
    await app
      .locator("[data-slot=boards-only-engine]")
      .getByRole("button", { name: "All engines" })
      .click()
    await expect(landing(app)).toBeVisible()
  })

  test("in German: the gate's title and its words", async ({ page }) => {
    const app = await openCockpit(page, { locale: "de-DE" })
    await engineRow(app, new RegExp(`^${C8_ENGINE} , `)).click()
    await expect(
      app.getByRole("heading", { level: 1, name: `${C8_ENGINE} läuft auf Camunda 8` }),
    ).toBeVisible()
    await expect(app.getByText("Du kannst sie auch in Operate öffnen.")).toBeVisible()
  })

  for (const engine of [C8_ENGINE, C8_UNBOARDED_ENGINE]) {
    test(`axe: the gate of ${engine} (WCAG 2.2 A/AA)`, async ({ page }) => {
      const app = await openCockpit(page)
      await engineRow(app, new RegExp(`^${engine} , `)).click()
      await expect(gate(app, engine)).toBeVisible()
      await expectAxeClean(page, `gate of ${engine}`)
    })
  }

  test("forced colours: the gate's board list keeps its edge, its marks their colour", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openCockpit(page)
    await engineRow(app, new RegExp(`^${C8_ENGINE} , `)).click()
    const boards = app.getByRole("list", { name: `Boards that name ${C8_ENGINE}` })
    await expect(boards).toBeVisible()
    const canvasText = await systemColour(boards, "CanvasText")
    const edge = await boards.evaluate((el) => {
      const style = getComputedStyle(el)
      return { style: style.borderTopStyle, colour: style.borderTopColor }
    })
    expect(edge).toEqual({ style: "solid", colour: canvasText })
    // A mark takes the system colour of what it sits in, as its text does, never its own quiet
    // tone: the gate's engine mark the canvas text, a board row's the button text, Operate's the
    // link text.
    const state = app.locator("[data-slot=boards-only-engine]")
    const buttonText = await systemColour(boards, "ButtonText")
    const linkText = await systemColour(boards, "LinkText")
    expect(await coloursOf(state.locator("[data-slot=empty-state] svg"))).toEqual([canvasText])
    expect(await coloursOf(boards.locator("svg"))).toEqual([buttonText, buttonText])
    expect(await coloursOf(state.getByRole("link").locator("svg"))).toEqual([linkText])
  })

  test("dark: the gate on the dark ground", async ({ page }) => {
    const app = await openCockpit(page, { theme: "dark" })
    await engineRow(app, new RegExp(`^${C8_ENGINE} , `)).click()
    await expect(gate(app, C8_ENGINE)).toBeVisible()
    const dark = await app.locator("html").evaluate((html) => html.classList.contains("dark"))
    expect(dark).toBe(true)
    await expectAxeClean(page, "gate (dark)")
  })
})

test.describe("Camunda 8 on a board", () => {
  test("the board: the cluster's numbers, its keys by their tail, its Zeebe diagram drawn", async ({
    page,
  }) => {
    const app = await openCockpit(page, { args: BOARD_ARGS })
    await drawn(app)
    const chips = app.getByRole("group", { name: "Engines of this board" })
    await expect(chips.locator("[data-part=board-engine]")).toHaveText(
      `${C8_ENGINE}Camunda 8 8.9.28 · 3 running · 1 with incident`,
    )
    const counter = tile(app, "Orders in flight")
    await expect(counter.locator("[data-part=counter-value]")).toHaveText("3")
    await expect(counter.locator("[data-part=counter-entry]")).toHaveText(`${C8_ENGINE}3`)

    // A key beyond 2^53 and one of 19 digits keep their digits: whole in a cell where the instance
    // has no business key, by their tail on its copy, which every key of a partition shares not.
    const instances = tile(app, "Running instances of pulse-order")
    await expect(instances.getByRole("row")).toHaveCount(4)
    await expect(instances.getByText(LONG_ORDER_KEY, { exact: true })).toBeVisible()
    await expect(instances.getByRole("button", { name: "Copy …27388111" })).toBeVisible()

    // The Zeebe diagram, its zeebe: extensions read past: every element, its count badges.
    const diagram = tile(app, "Order fulfillment")
    await expect(diagram.getByText(`${C8_ENGINE} · v2, the latest version`)).toBeVisible()
    await expect(diagram.getByRole("img", { name: "BPMN process diagram" })).toContainText(
      "Charge payment",
    )
    // The badges of the elements' statistics: two waiting, one incident at Charge payment.
    const badges = diagram.locator(".djs-overlays")
    await expect(badges.getByText("2", { exact: true })).toBeVisible()
    await expect(badges.getByText("1", { exact: true })).toBeVisible()

    const facts = JSON.parse((await hostLog(page)).originalResult?.content?.[0]?.text ?? "{}") as {
      engines?: unknown[]
    }
    expect(facts.engines).toEqual([
      { name: HEALTHY_ENGINE, state: "ready", product: "CIB seven", running: 3, withIncident: 0 },
      { name: C8_ENGINE, state: "ready", product: "Camunda 8", running: 3, withIncident: 1 },
    ])
  })

  // No view of the cockpit reads a Camunda 8 engine (ROUTE_DIALECTS), so the board offers no way
  // into one: no drill, no count, summary row or diagram that opens, and a chip that opens nothing.
  // The stub's chip still opens its overview.
  test("a Camunda 8 engine's tiles and chip open nothing, and nothing reads it but the board", async ({
    page,
  }) => {
    const app = await openCockpit(page, { args: BOARD_ARGS })
    await drawn(app)
    for (const name of ["Orders in flight", "Running instances of pulse-order", "Open incidents"]) {
      await expect(tile(app, name).getByRole("button", { name: /^Open\b|c8-orders/ })).toHaveCount(
        0,
      )
    }
    await expect(
      tile(app, "Order fulfillment").getByRole("button", { name: "Open process" }),
    ).toHaveCount(0)
    const chips = app.getByRole("group", { name: "Engines of this board" })
    await expect(chips.getByRole("button")).toHaveCount(1)
    await chips.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE} `) }).click()
    await expect(app.getByRole("navigation", { name: "Cockpit sections" })).toBeVisible()
    expect((await callsForCamunda8(page)).map((call) => call.name)).toEqual([
      "engine_bpmn_xml_data",
    ])
  })

  // The chip that opens nothing keeps a button's one line: its name whole, its facts cut.
  test("at 320 px a Camunda 8 engine's chip stays on one line, as tall as the stub's button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 900 })
    const app = await openCockpit(page, { args: BOARD_ARGS, width: 320 })
    await drawn(app)
    const chips = app.getByRole("group", { name: "Engines of this board" })
    const text = chips.locator("[data-part=board-engine]")
    const button = chips.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE} `) })
    const [textBox, buttonBox] = [await text.boundingBox(), await button.boundingBox()]
    expect(textBox?.height).toBe(buttonBox?.height)
    // The name's text sits on one line: a break at its hyphen would give it two line boxes.
    const nameLines = await text.getByText(C8_ENGINE, { exact: true }).evaluate((name) => {
      const range = document.createRange()
      range.selectNodeContents(name)
      return range.getClientRects().length
    })
    expect(nameLines).toBe(1)
  })

  test("dark: the tiles on the dark card, the Zeebe diagram's paper stays light", async ({
    page,
  }) => {
    const app = await openCockpit(page, { args: BOARD_ARGS, theme: "dark" })
    await drawn(app)
    const card = tile(app, "Order fulfillment")
    const dark = await app.locator("html").evaluate((html) => html.classList.contains("dark"))
    expect(dark).toBe(true)
    expect(await backgroundLuminance(card)).toBeLessThan(0.3)
    // The paper the canvas is drawn on, its nearest light island, is light on the dark card.
    const canvas = card.getByRole("img", { name: "BPMN process diagram" })
    const paper = canvas.locator("xpath=ancestor::*[@data-theme-mode='light'][1]")
    expect(await backgroundLuminance(paper)).toBeGreaterThan(0.95)
  })

  test("forced colours: a Camunda 8 tile keeps its edge", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openCockpit(page, { args: BOARD_ARGS })
    await drawn(app)
    const card = tile(app, "Orders in flight")
    const canvasText = await systemColour(card, "CanvasText")
    const edge = await card.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        style: style.borderTopStyle,
        width: style.borderTopWidth,
        colour: style.borderTopColor,
      }
    })
    expect(edge).toEqual({ style: "solid", width: "1px", colour: canvasText })
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe: the board over the stub and Camunda 8 (WCAG 2.2 A/AA, ${theme})`, async ({
      page,
    }) => {
      const app = await openCockpit(page, { args: BOARD_ARGS, theme })
      await drawn(app)
      await expectAxeClean(page, `board (${theme})`)
    })
  }
})
