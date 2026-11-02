import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import { REALISTIC_ENGINE, REALISTIC_HOST_ENV } from "./engines.js"

/**
 * The measured inline fit (#396) on real-sized data (`realistic-engine.ts`):
 * long process names and keys, 160 instances, 73 jobs. A list view inline in
 * a chat's column (760 px) is ONE card that fits the host's height budget:
 * its list shows the rows that fit, at least one, says how many of how many,
 * and offers the rest ("Show all"); the view never scrolls inside itself.
 * The fixture engine's short rows fit any budget, which is how the first
 * version of this check passed while the playground scrolled.
 */

interface View {
  name: string
  tool: string
  args: Record<string, unknown>
  /** The footer's count line, "Showing 3 of 160 instances". */
  count: RegExp
}

const VIEWS: View[] = [
  {
    name: "instances, engine-wide",
    tool: "engine_open_cockpit",
    args: { engine: REALISTIC_ENGINE, view: "process-instances" },
    count: /^Showing (\d+) of (\d+) instances$/,
  },
  {
    name: "instances of one process",
    tool: "engine_open_cockpit",
    args: {
      engine: REALISTIC_ENGINE,
      view: "process-instances",
      processDefinitionKey: "assessCreditworthiness",
    },
    count: /^Showing (\d+) of (\d+) instances$/,
  },
  {
    name: "jobs",
    tool: "engine_open_cockpit",
    args: { engine: REALISTIC_ENGINE, view: "jobs" },
    count: /^Showing (\d+) of (\d+) jobs$/,
  },
]

async function openView(
  page: Page,
  view: View,
  { maxHeight, width = 760, locale }: { maxHeight?: number; width?: number; locale?: string } = {},
): Promise<FrameLocator> {
  const base = process.env[REALISTIC_HOST_ENV]
  if (!base)
    throw new Error(`${REALISTIC_HOST_ENV} is unset — run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: view.tool,
    args: JSON.stringify(view.args),
    structuredContent: "keep",
    theme: "light",
    width: String(width),
    displayModes: "inline,fullscreen",
  })
  if (maxHeight !== undefined) query.set("maxHeight", String(maxHeight))
  if (locale) query.set("locale", locale)
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

/** The view's document box (`HostDocument`): the fit's verdict and whether it scrolls. */
async function documentBox(app: FrameLocator) {
  return app.locator("[data-inline-fit]").evaluate((box) => ({
    fit: box.getAttribute("data-inline-fit"),
    scrolls:
      box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).display !== "contents",
  }))
}

/** Rows shown, rows in all, as the footer's count line says them. */
async function shownOf(app: FrameLocator, view: View): Promise<{ shown: number; total: number }> {
  const line = app.getByText(view.count)
  await expect(line).toBeVisible({ timeout: 20_000 })
  const [, shown, total] = view.count.exec((await line.textContent()) ?? "")!
  return { shown: Number(shown), total: Number(total) }
}

/**
 * The "Show all" button sits on the card, inside the budget: the document
 * does not scroll (`documentBox`), so its layout position is where it shows.
 * (The host sim's frame is a fixed 720 px; an 800 px card would be cut by
 * the frame, not by the host.)
 */
async function expectShowAllOnCard(app: FrameLocator, name: string, budget: number) {
  const button = app.getByRole("button", { name })
  await expect(button).toBeVisible()
  const bottom = await button.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY)
  expect(bottom, `${name} at ${bottom}px, budget ${budget}px`).toBeLessThanOrEqual(budget)
}

/** The rows the list's table shows (its body rows). */
const tableRows = (app: FrameLocator) => app.locator("tbody > tr")

/** The last size the view reported to the host. */
async function reportedHeight(page: Page): Promise<number> {
  const log = await page.evaluate(
    () =>
      (window as unknown as { __hostLog: { sizeChanges: Array<{ height: number }> } }).__hostLog,
  )
  return log.sizeChanges.at(-1)?.height ?? Number.NaN
}

/** The fit has settled: the same row count twice, half a second apart. */
async function settledRows(app: FrameLocator): Promise<number> {
  let last = -1
  await expect
    .poll(
      async () => {
        const now = await tableRows(app).count()
        const stable = now === last
        last = now
        return stable
      },
      { intervals: [500], timeout: 10_000 },
    )
    .toBe(true)
  return last
}

async function expectFits(
  page: Page,
  app: FrameLocator,
  view: View,
  budget: number,
  showAll = "Show all",
) {
  await shownOf(app, view)
  // The rows settle first; the count line then says exactly them.
  const rows = await settledRows(app)
  await expect.poll(async () => (await shownOf(app, view)).shown).toBe(rows)
  const { total } = await shownOf(app, view)
  expect(rows).toBeGreaterThanOrEqual(1)
  expect(rows).toBeLessThan(total)
  expect(await documentBox(app)).toEqual({ fit: "fits", scrolls: false })
  // The way to the rest is on the card, not under a fold.
  await expectShowAllOnCard(app, showAll, budget)
  expect(await reportedHeight(page)).toBeLessThanOrEqual(budget)
  return rows
}

test.describe("inline fit on real-sized data (760 px column)", () => {
  for (const view of VIEWS) {
    test(`${view.name}: fits a 600 px and an 800 px budget as one card`, async ({ page }) => {
      const at600 = await expectFits(
        page,
        await openView(page, view, { maxHeight: 600 }),
        view,
        600,
      )
      const at800 = await expectFits(
        page,
        await openView(page, view, { maxHeight: 800 }),
        view,
        800,
      )
      expect(at800, "a larger budget shows more rows").toBeGreaterThan(at600)
    })
  }

  test("without a stated budget the list is fitted as if it were 600 px, and never capped", async ({
    page,
  }) => {
    const view = VIEWS[0]
    const app = await openView(page, view)
    // No cap on the document (its box has no height of its own to scroll in),
    // and the list fitted to 600 px all the same.
    await expectFits(page, app, view, 600)
  })

  test("a new budget at runtime refits: more rows for a larger one, fewer for a smaller one", async ({
    page,
  }) => {
    const view = VIEWS[0]
    const app = await openView(page, view, { maxHeight: 600 })
    const at600 = await expectFits(page, app, view, 600)

    await page.evaluate(() =>
      (
        window as unknown as { __hostSim: { setContext: (p: unknown) => void } }
      ).__hostSim.setContext({
        containerDimensions: { maxHeight: 800 },
      }),
    )
    await expect.poll(() => tableRows(app).count()).toBeGreaterThan(at600)
    await expectFits(page, app, view, 800)

    await page.evaluate(() =>
      (
        window as unknown as { __hostSim: { setContext: (p: unknown) => void } }
      ).__hostSim.setContext({
        containerDimensions: { maxHeight: 600 },
      }),
    )
    await expect.poll(() => tableRows(app).count()).toBe(at600)
    await expectFits(page, app, view, 600)
  })

  test("another column width refits the list, also after the user touched the view", async ({
    page,
  }) => {
    const view = VIEWS[0]
    // Under the cockpit's head few rows of these fit 600 px at 760 px, so the list refits
    // within an 800 px budget, where a narrower column can show fewer.
    const app = await openView(page, view, { maxHeight: 800 })
    const at760 = await expectFits(page, app, view, 800)
    expect(at760, "room to show fewer").toBeGreaterThan(1)
    // The user touches the view: from now on only a new epoch refits.
    await app.locator("body").dispatchEvent("pointerdown")

    const setWidth = (px: number) =>
      page.evaluate(
        (width) =>
          (
            window as unknown as { __hostSim: { setWidth: (w: number) => void } }
          ).__hostSim.setWidth(width),
        px,
      )
    // Narrower: the rows wrap taller, fewer fit.
    await setWidth(560)
    await expect.poll(() => tableRows(app).count()).toBeLessThan(at760)
    await expectFits(page, app, view, 800)

    // Wide enough for the State column again (hidden below 48rem).
    await setWidth(960)
    await expect(app.getByRole("columnheader", { name: "State" })).toBeVisible()
    await expectFits(page, app, view, 800)
  })

  test("German: the same card, in German", async ({ page }) => {
    const view: View = { ...VIEWS[2], count: /^Zeigt (\d+) von (\d+) Jobs$/ }
    const app = await openView(page, view, { maxHeight: 600, locale: "de-DE" })
    await expectFits(page, app, view, 600, "Alle anzeigen")
  })
})
