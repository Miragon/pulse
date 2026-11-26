import { expect, test, type Page } from "@playwright/test"
import { CHAIN_ENGINE } from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  originOf,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The web app's instance screen and its incident focus (D10, step 10 of the plan), on the `chain`
 * deployment, whose one engine replays an Operaton run of the conformance world (chain-engine.ts):
 * DSP-3001 waits at its call activity for the root incident of the "Print label" instance it
 * called, a failed job whose stack trace names its root cause. The journey follows that failure
 * from the process's instance list (the process screen, from the list's old address) to the
 * instance, where its incident card
 * says where the failure lies ("Located in"), on to the called instance with the incident in focus
 * (its card open, its stack trace read in place with the root cause line marked, its element
 * selected on the diagram), to the caller and Back. An ended instance opens from its history, an
 * instance the engine does not know is a refusal without Try again, the tab rides in the address,
 * the separator moves by keyboard, each address shows its screen after a reload and an old one
 * gives way to it, an old incident address leads to the instance that holds its root, nothing offers
 * a write or a hand-off, in German, dark and at 320 px axe finds nothing (the card in focus scrolled
 * into sight under the heading that holds the focus), and under forced colours an element already
 * done is drawn and explained apart from a wait.
 */

const DISPATCH = "90e6fbd3-e5ee-11f1-8e48-a299d3128296"
const LABEL = "90e79819-e5ee-11f1-8e48-a299d3128296"
const ROOT_INCIDENT = "90ee7600-e5ee-11f1-8e48-a299d3128296"
const COPY_INCIDENT = "90ee7601-e5ee-11f1-8e48-a299d3128296"
const ENDED = "7f0c0eb3-e5ee-11f1-8e48-a299d3128296"
const UNKNOWN = "4f0c0eb3-e5ee-11f1-8e48-a299d3128296"

const ENGINE = `/app/engines/${CHAIN_ENGINE}`
const instanceUrl = (id: string) => `${ENGINE}/instances/${id}`
const incidentUrl = (instance: string, incident: string) =>
  `${instanceUrl(instance)}/incidents/${incident}`

/** Where the scenario's screenshots go for a look by eye (the diagram's markers on dark paper). */
const SHOTS = process.env.WEB_SIM_SHOTS

const heading = (page: Page) => page.getByRole("heading", { level: 1 })
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name })
const card = (page: Page) => page.locator("[data-part=incident-card]")
const separator = (page: Page) => page.getByRole("separator", { name: /Resize diagram/ })

/** The path and query the page's address shows. */
const here = (page: Page) => {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

/** No control of the page writes to the engine or hands off to a chat. */
async function expectNoWrite(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: /retry|resolve|edit|move|suspend|cancel|ask|chat/i }),
  ).toHaveCount(0)
  await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
}

test.describe("the instance screen", () => {
  test("follows a failure from the process's instances to its root cause, the caller and back", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, `${ENGINE}/instances?process=pulse-dispatch`, { deployment: "chain" })
    // The process's instances, the old address of the list now the process screen: its row opens
    // the instance.
    const row = page.getByRole("row", { name: /DSP-3001/ })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await expect(page).toHaveURL(new RegExp(`${instanceUrl(DISPATCH)}$`))
    await expect(heading(page)).toHaveText("DSP-3001")
    await expect(heading(page)).toBeFocused()
    // It waits for an incident in the instance it called: the strip says where, the Incidents tab
    // opens on its root incident, which says where it lies.
    await expect(
      page.getByText(/Waits at Print shipping label on an incident in a called instance since/),
    ).toBeVisible()
    await expect(tab(page, /^Incidents/)).toHaveAttribute("aria-selected", "true")
    await expect(card(page)).toHaveCount(1)
    await expect(card(page)).toContainText("Root cause")
    await expect(card(page)).toContainText("PropertyNotFoundException: Cannot resolve identifier")
    const liesIn = card(page).getByRole("link", { name: /pulse-label 90e79819/ })
    await expect(liesIn).toHaveAttribute("href", incidentUrl(LABEL, ROOT_INCIDENT))
    // The call activity's way to the instance it called, on the diagram.
    await expect(page.locator("[data-part=call-button]")).toHaveAttribute(
      "href",
      instanceUrl(LABEL),
    )
    await expectNoWrite(page)
    // Located in: the called instance, its root incident in focus.
    await liesIn.click()
    await expect(page).toHaveURL(new RegExp(`${incidentUrl(LABEL, ROOT_INCIDENT)}$`))
    await expect(heading(page)).toHaveText("90e79819…")
    await expect(heading(page)).toBeFocused()
    const caller = page.locator("[data-slot=caller-strip]")
    await expect(caller).toContainText("Called by DSP-3001")
    await expect(caller).toContainText("Dispatch order v1")
    // The card in focus reads its stack trace at once and marks its root cause's line.
    await expect(page.getByRole("button", { name: "Hide stacktrace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    const cause = page.locator("[data-part=root-cause-line]")
    await expect(cause).toContainText("Caused by:")
    await expect(cause).toContainText("PropertyNotFoundException")
    await expect(page.getByRole("button", { name: "Copy stacktrace" })).toBeVisible()
    // Its long lines unwrapped scroll in the text's own box: the split stays as wide as the screen,
    // the diagram keeps its zoom bar and bpmn.io's link in the window.
    const split = page.locator("[data-slot=split-pane]")
    expect(await split.evaluate((pane) => pane.scrollWidth - pane.clientWidth)).toBe(0)
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeInViewport()
    await expect(page.getByRole("link", { name: /bpmn\.io/ })).toBeInViewport()
    await page.getByRole("button", { name: "Wrap lines" }).click()
    await expect(page.getByRole("button", { name: "Wrap lines" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    // Every incident with its cause, the cockpit's cause view of Camunda 7.
    const sameCause = page.getByRole("link", { name: "All with this cause" })
    await expect(sameCause).toHaveAttribute(
      "href",
      /\/incidents\/cause\?activity=Activity_RenderLabel&type=failedJob&signature=/,
    )
    // Its element is selected on the diagram.
    await expect(page.locator(".djs-shape.pulse-selected")).toHaveAttribute(
      "data-element-id",
      "Activity_RenderLabel",
    )
    expect(calls.filter((call) => call.name === "engine_screen_incident_text_data")).toHaveLength(1)
    await expectNoWrite(page)
    // Open caller, then Back to the incident, Back to the instance, Back to the list.
    await caller.getByRole("link", { name: "Open caller" }).click()
    await expect(page).toHaveURL(new RegExp(`${instanceUrl(DISPATCH)}$`))
    await expect(heading(page)).toHaveText("DSP-3001")
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${incidentUrl(LABEL, ROOT_INCIDENT)}$`))
    await expect(heading(page)).toHaveText("90e79819…")
    await page.goBack()
    await expect(heading(page)).toHaveText("DSP-3001")
    await page.goBack()
    await expect(page.getByRole("row", { name: /DSP-3001/ })).toBeVisible()
    await rendered(page)
    expect(errors).toEqual([])
  })

  test("shows the screen at each of its addresses and after a reload, an old address giving way", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signIn(page, ENGINE, { deployment: "chain" })
    for (const [address, title, selected] of [
      [instanceUrl(DISPATCH), "DSP-3001", /^Incidents/],
      [`${instanceUrl(DISPATCH)}?tab=history`, "DSP-3001", /^History/],
      [incidentUrl(LABEL, ROOT_INCIDENT), "90e79819…", /^Incidents/],
    ] as const) {
      await page.goto(`${originOf("chain")}${address}`)
      await expect(heading(page), address).toHaveText(title, { timeout: 15_000 })
      await expect(tab(page, selected), address).toHaveAttribute("aria-selected", "true")
      await page.reload()
      await expect(heading(page), address).toHaveText(title, { timeout: 15_000 })
      await expect(tab(page, selected), address).toHaveAttribute("aria-selected", "true")
      expect(here(page), address).toBe(address)
    }
    // The cockpit's old addresses of an instance and its history: replaced in their entry.
    const old = (query: string) => `/app/cockpit?${query}&engine=${CHAIN_ENGINE}`
    for (const [address, canonical] of [
      [old(`view=instance-detail&processInstanceId=${DISPATCH}`), instanceUrl(DISPATCH)],
      [old(`view=history&processInstanceId=${DISPATCH}`), `${instanceUrl(DISPATCH)}?tab=history`],
    ] as const) {
      const before = await page.evaluate(() => history.length)
      await page.goto(`${originOf("chain")}${address}`)
      await expect(heading(page), address).toHaveText("DSP-3001", { timeout: 15_000 })
      expect(here(page), address).toBe(canonical)
      expect(await page.evaluate(() => history.length), address).toBe(before + 1)
    }
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${instanceUrl(DISPATCH)}$`))
    await expect(heading(page)).toHaveText("DSP-3001")
  })

  test("opens an ended instance from its history, on its history", async ({ page }) => {
    await signIn(page, instanceUrl(ENDED), { deployment: "chain" })
    await expect(heading(page)).toHaveText("DSP-2999", { timeout: 15_000 })
    await expect(page.getByText("This instance is completed.")).toBeVisible()
    await expect(tab(page, /^History/)).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("table", { name: "History" }).locator("tbody tr")).toHaveCount(3)
    await expectNoWrite(page)
  })

  test("refuses an instance the engine does not know, with no Try again", async ({ page }) => {
    const calls = recordCalls(page)
    await signIn(page, instanceUrl(UNKNOWN), { deployment: "chain" })
    await expect(page.getByRole("heading", { name: /isn't on engine shop/ })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Processes of shop" })).toHaveAttribute(
      "href",
      ENGINE,
    )
    await rendered(page)
    // A refusal no retry changes is asked once.
    expect(calls.filter((call) => call.name === "engine_screen_instance_data")).toHaveLength(1)
  })

  test("carries the tab in the address, and moves the separator by keyboard", async ({ page }) => {
    await signIn(page, instanceUrl(DISPATCH), { deployment: "chain" })
    await expect(heading(page)).toHaveText("DSP-3001", { timeout: 15_000 })
    const entries = await page.evaluate(() => history.length)
    await tab(page, /^Variables/).click()
    await expect(page).toHaveURL(new RegExp(`${instanceUrl(DISPATCH)}\\?tab=variables$`))
    expect(await page.evaluate(() => history.length)).toBe(entries)
    await expect(page.getByRole("table", { name: "Variables" })).toContainText("orderId")
    await expect(tab(page, /^Variables/)).toBeFocused()
    await separator(page).focus()
    const before = Number(await separator(page).getAttribute("aria-valuenow"))
    await page.keyboard.press("ArrowDown")
    await expect(separator(page)).toHaveAttribute("aria-valuenow", String(before + 5))
    await page.keyboard.press("End")
    await expect(separator(page)).toHaveAttribute("aria-valuenow", "80")
    await page.reload()
    await expect(tab(page, /^Variables/)).toHaveAttribute("aria-selected", "true", {
      timeout: 15_000,
    })
    await expect(separator(page)).toHaveAttribute("aria-valuenow", "80")
    expect(here(page)).toBe(`${instanceUrl(DISPATCH)}?tab=variables`)
  })

  test("leads an old incident address to the instance that holds its root", async ({ page }) => {
    const old = `/app/cockpit?view=incident-detail&engine=${CHAIN_ENGINE}&incidentId=${COPY_INCIDENT}`
    await signIn(page, ENGINE, { deployment: "chain" })
    await page.goto(`${originOf("chain")}${old}`)
    await expect(page).toHaveURL(new RegExp(`${incidentUrl(LABEL, ROOT_INCIDENT)}$`), {
      timeout: 15_000,
    })
    await expect(heading(page)).toHaveText("90e79819…")
    await expect(page.locator("[data-part=root-cause-line]")).toContainText("Caused by:")
  })

  test("in German, dark and at 320 px, axe finds nothing", async ({ page }) => {
    test.setTimeout(90_000)
    await signIn(page, incidentUrl(LABEL, ROOT_INCIDENT), { deployment: "chain" })
    await expect(page.locator("[data-part=root-cause-line]")).toBeVisible({ timeout: 15_000 })
    await rendered(page)
    await expectNoAxeFinding(page)
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto(`${originOf("chain")}${instanceUrl(DISPATCH)}`)
    await expect(page.locator(".djs-shape.pulse-incident-called")).toBeVisible({ timeout: 15_000 })
    await rendered(page)
    if (SHOTS !== undefined) {
      await page.screenshot({ path: `${SHOTS}/instance-dark.png` })
      await page.locator("[data-slot=instance-diagram]").screenshot({
        path: `${SHOTS}/instance-dark-diagram.png`,
      })
    }
    await expectNoAxeFinding(page)
    const german = await page
      .context()
      .browser()!
      .newContext({ locale: "de-DE", colorScheme: "dark" })
    const de = await german.newPage()
    await de.setViewportSize({ width: 320, height: 720 })
    await signIn(de, incidentUrl(LABEL, ROOT_INCIDENT), { deployment: "chain" })
    await expect(de.getByRole("tab", { name: /^Incidents/ })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 15_000 },
    )
    await expect(de.locator("[data-slot=caller-strip]")).toContainText("Aufgerufen von DSP-3001")
    await expect(de.getByRole("link", { name: "Aufrufer öffnen" })).toBeVisible()
    await rendered(de)
    if (SHOTS !== undefined)
      await de.screenshot({ path: `${SHOTS}/instance-de-320.png`, fullPage: true })
    expect(await de.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    // The stack trace scrolls in its own box, its controls in sight: nothing runs off the card.
    for (const part of [
      de.locator("[data-part=incident-text]"),
      de.getByRole("button", { name: "Zeilen umbrechen" }),
    ]) {
      const box = await part.boundingBox()
      expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(320)
    }
    await expectNoAxeFinding(de)
    // Back to the incident from the caller, its instance read already: the page stacks and scrolls,
    // the heading takes the focus and the card in focus still scrolls into sight below it.
    await de.getByRole("link", { name: "Aufrufer öffnen" }).click()
    await expect(heading(de)).toHaveText("DSP-3001")
    await card(de)
      .getByRole("link", { name: /pulse-label 90e79819/ })
      .click()
    await expect(de).toHaveURL(new RegExp(`${incidentUrl(LABEL, ROOT_INCIDENT)}$`))
    await expect(heading(de)).toBeFocused()
    // Most of it in sight: the heading's focus scrolled the page back up before the card's turn.
    await expect(de.locator("[data-focus]")).toBeInViewport({ ratio: 0.5 })
    await german.close()
  })

  test("under forced colours, draws and explains an element already done apart from a wait", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" })
    await signIn(page, instanceUrl(DISPATCH), { deployment: "chain" })
    await expect(page.locator(".djs-shape.pulse-completed")).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Legend" }).click()
    const seen = await page.evaluate(() => {
      // A system colour as the forced palette resolves it.
      const system = (name: string) => {
        const probe = document.createElement("span")
        probe.style.forcedColorAdjust = "none"
        probe.style.color = name
        document.body.append(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }
      const outline = (marker: string) =>
        getComputedStyle(
          document.querySelector(`.djs-shape.${marker} > .djs-visual > :first-child`)!,
        )
      const swatch = (kind: string) => {
        const style = getComputedStyle(document.querySelector(`.pulse-swatch--${kind}`)!)
        return `${style.borderTopStyle} ${style.borderTopWidth} ${
          style.borderTopColor === system("Highlight")
            ? "Highlight"
            : style.borderTopColor === system("GrayText")
              ? "GrayText"
              : style.borderTopColor
        }`
      }
      const done = outline("pulse-completed")
      const called = outline("pulse-incident-called")
      return {
        done: [done.stroke === system("GrayText"), done.fill === system("Canvas")],
        called: called.stroke === system("Highlight"),
        apart: system("GrayText") !== system("Highlight"),
        legend: ["waiting", "incident", "incidentInCalledInstance", "completed"].map(swatch),
      }
    })
    expect(seen).toEqual({
      done: [true, true],
      called: true,
      apart: true,
      legend: [
        "solid 2px Highlight",
        "solid 3px Highlight",
        "dashed 2px Highlight",
        "solid 2px GrayText",
      ],
    })
  })
})
