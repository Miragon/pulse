import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import {
  C8_ALONE_REFUSED_HOST_ENV,
  C8_ENGINE,
  HEALTHY_ENGINE,
  REFUSED_C8_ENGINE,
  REFUSED_C8_HOST_ENV,
  REFUSED_ENGINE,
  REFUSED_HOST_ENV,
} from "./engines.js"

/**
 * A profile the server refuses, in the BUILT bundle: the deployment of global-setup.ts runs the
 * stub engine next to a profile whose secret's variable is not set. The landing lists both, the
 * refused one in words as refused, opening it says why in the host's language, at once and once,
 * without Try again (F1: the server refuses at once and keeps refusing, so a retry only held the
 * reason back for 7 s), and `engine_open_cockpit` on it opens the picker instead of failing. The
 * start data names the profile refused, so neither its row nor its view reads anything of it. A
 * refused profile of the other dialect, which the server offers no feed for, says its own reason
 * alike, beside a Camunda 7 engine and beside a Camunda 8 engine alone. Each gate's title is the
 * page's one heading (axe's best practices).
 */

async function openCockpit(
  page: Page,
  args: Record<string, unknown>,
  { locale = "en-US", deployment = REFUSED_HOST_ENV } = {},
): Promise<FrameLocator> {
  const base = process.env[deployment]
  if (!base) throw new Error(`${deployment} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify(args),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme: "light",
    locale,
  })
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

/** The tools/call requests the view made through the host. */
async function toolCalls(page: Page): Promise<Array<{ name: string; arguments: object }>> {
  return await page.evaluate(
    () =>
      (
        window as unknown as {
          __hostLog: { toolCalls: Array<{ name: string; arguments: object }> }
        }
      ).__hostLog.toolCalls,
  )
}

/** The calls that named `engine`. */
async function callsOf(page: Page, engine: string) {
  return (await toolCalls(page)).filter(
    (call) => (call.arguments as { engine?: unknown }).engine === engine,
  )
}

/** An engine's row on the landing: its name leads the button's accessible name. */
const rowOf = (app: FrameLocator, engine: string) =>
  app.getByRole("button", { name: new RegExp(`^${engine}\\b`) })

/** WCAG 2.2 A/AA and axe's best practices, its page-has-heading-one among them, on the view. */
async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .include("#app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"])
    .analyze()
  const violations = results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }))
  expect(violations, label).toEqual([])
}

/**
 * Opens the refused engine as soon as its row shows: its reason follows within a second, once,
 * as the view's one heading, without Try again and without the head's sections, and nothing reads
 * the engine (the start data named it refused).
 */
async function openRefused(page: Page, app: FrameLocator, engine: string, title: string) {
  await rowOf(app, engine).click({ timeout: 15_000 })
  const heading = app.getByRole("heading", { level: 1, name: title })
  await expect(heading).toHaveCount(1, { timeout: 1_000 })
  await expect(heading).toBeVisible()
  await expect(app.getByRole("heading", { level: 1 })).toHaveCount(1)
  await expect(app.getByText(title)).toHaveCount(1)
  await expect(app.getByRole("button", { name: /^(Try again|Erneut versuchen)$/ })).toHaveCount(0)
  await expect(
    app.getByRole("navigation", { name: /^(Cockpit sections|Cockpit-Bereiche)$/ }),
  ).toHaveCount(0)
  expect(await callsOf(page, engine)).toEqual([])
}

test.describe("landing with a refused profile", () => {
  test("lists the refused engine as refused next to the usable one, at once", async ({ page }) => {
    const app = await openCockpit(page, {})
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(rowOf(app, HEALTHY_ENGINE)).toBeVisible()
    // The server refuses at once: a retried read would leave the row loading for 7 s.
    await expect(rowOf(app, REFUSED_ENGINE)).toHaveAccessibleName(/\bprofile refused$/, {
      timeout: 3_000,
    })
  })

  test("opening it says why within a second, once, without Try again, in English and German", async ({
    page,
  }) => {
    const app = await openCockpit(page, {})
    await openRefused(
      page,
      app,
      REFUSED_ENGINE,
      `Engine ${REFUSED_ENGINE} cannot be used: its profile is refused`,
    )
    await expect(
      app.getByText(
        new RegExp(`^\\[ENGINE_PROFILE_REFUSED\\] Engine "${REFUSED_ENGINE}" is configured`),
      ),
    ).toBeAttached()
    await expectAxeClean(page, REFUSED_ENGINE)

    const de = await openCockpit(page, {}, { locale: "de-DE" })
    await openRefused(
      page,
      de,
      REFUSED_ENGINE,
      `Die Engine ${REFUSED_ENGINE} ist nicht nutzbar: ihr Profil ist abgelehnt`,
    )
  })

  test("engine_open_cockpit on it opens the picker, not a tool error", async ({ page }) => {
    const app = await openCockpit(page, { engine: REFUSED_ENGINE })
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(app.getByLabel("Selected engine")).toHaveCount(0)
  })
})

/**
 * A refused profile the server offers no feed for: its feeds' engine enums leave out another
 * dialect's refused profile (an input error), and a server of Camunda 8 engines alone registers
 * no feed of one engine (no such tool). The gate says the profile's own reason all the same.
 */
test.describe("a refused profile of the other dialect", () => {
  for (const { deployment, engine, beside } of [
    { deployment: REFUSED_C8_HOST_ENV, engine: REFUSED_C8_ENGINE, beside: HEALTHY_ENGINE },
    { deployment: C8_ALONE_REFUSED_HOST_ENV, engine: REFUSED_ENGINE, beside: C8_ENGINE },
  ]) {
    test(`${engine} beside ${beside}: says its own reason, reads nothing, keeps its h1`, async ({
      page,
    }) => {
      const app = await openCockpit(page, {}, { deployment })
      await expect(rowOf(app, engine)).toHaveAccessibleName(/\bprofile refused$/, {
        timeout: 15_000,
      })
      await openRefused(
        page,
        app,
        engine,
        `Engine ${engine} cannot be used: its profile is refused`,
      )
      await expect(
        app.getByText(new RegExp(`^\\[ENGINE_PROFILE_REFUSED\\] Engine "${engine}" is configured`)),
      ).toBeAttached()
      await expect(app.getByText(/Input validation error|not found/)).toHaveCount(0)
      // Its trail names it, the way back to the landing beside it.
      const trail = app.getByRole("navigation", { name: "Breadcrumb" })
      await expect(trail.getByRole("button")).toHaveText(["All engines"])
      await expect(trail).toContainText(engine)
      await expectAxeClean(page, engine)
    })
  }
})
