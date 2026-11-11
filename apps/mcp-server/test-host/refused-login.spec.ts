import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import {
  ACCESS_DENIED_ENGINE,
  LOGIN_REFUSED_ENGINE,
  REFUSED_ENGINE,
  REFUSED_HOST_ENV,
} from "./engines.js"

/**
 * Engines that refuse the server's login, in the BUILT bundle (F2 of the Inspector run of
 * 2026-11-09): the deployment of global-setup.ts sends a Basic login with a wrong password to a
 * stub engine that answers every request with a 401, and one to a stub engine that answers with
 * a 403 and the engine's AuthorizationException. Both run, so the landing's rows say "credentials
 * rejected" and "access denied" (describeError's 401 and 403 in short) with a key, never
 * "unreachable" with an unplugged cable, the cross-engine view counts them apart from the
 * unreachable ones in a refused profile's tone and never says they did not answer, and the
 * overview names the status. The view's client retries a 401 or 403 like any read (1 + 2 + 4 s),
 * so the rows word it after that.
 */

/** A 401 or 403 is retried three times before the row has its words. */
const RETRIED_MS = 15_000

async function openCockpit(page: Page, locale = "en-US"): Promise<FrameLocator> {
  const base = process.env[REFUSED_HOST_ENV]
  if (!base)
    throw new Error(`${REFUSED_HOST_ENV} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify({}),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme: "light",
    locale,
  })
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

/** An engine's row on the landing: its name leads the button's accessible name. */
const rowOf = (app: FrameLocator, engine: string) =>
  app.getByRole("button", { name: new RegExp(`^${engine}\\b`) })

test.describe("landing with an engine that refuses the server's login", () => {
  test("words the 401 as rejected credentials, never as unreachable, in English and German", async ({
    page,
  }) => {
    const app = await openCockpit(page)
    const row = rowOf(app, LOGIN_REFUSED_ENGINE)
    await expect(row).toHaveAccessibleName(/, credentials rejected$/, { timeout: RETRIED_MS })
    await expect(row).toHaveAttribute("data-status", "unauthorized")
    const denied = rowOf(app, ACCESS_DENIED_ENGINE)
    await expect(denied).toHaveAccessibleName(/, access denied$/, { timeout: RETRIED_MS })
    await expect(denied).toHaveAttribute("data-status", "forbidden")
    // The server's key, never the unplugged cable of an engine that is down.
    for (const refused of [row, denied]) {
      await expect(refused.locator("svg.lucide-key-round")).toHaveCount(1)
      await expect(refused.locator("svg.lucide-unplug")).toHaveCount(0)
    }
    await expect(rowOf(app, REFUSED_ENGINE)).toHaveAccessibleName(/, profile refused$/)
    await expect(app.getByText("unreachable", { exact: true })).toHaveCount(0)

    const de = await openCockpit(page, "de-DE")
    await expect(rowOf(de, LOGIN_REFUSED_ENGINE)).toHaveAccessibleName(
      /, Zugangsdaten abgelehnt$/,
      { timeout: RETRIED_MS },
    )
    await expect(rowOf(de, ACCESS_DENIED_ENGINE)).toHaveAccessibleName(/, Zugriff verweigert$/, {
      timeout: RETRIED_MS,
    })
    await expect(de.getByText("nicht erreichbar", { exact: true })).toHaveCount(0)
  })

  test("the cross-engine view counts it apart from the unreachable ones, as a warning", async ({
    page,
  }) => {
    const app = await openCockpit(page)
    await app.getByRole("button", { name: "Cross-engine overview" }).click({ timeout: 15_000 })
    const landscape = app.getByRole("region", { name: "Process landscape" })
    const words = "1 with profile refused · 1 with credentials rejected · 1 with access denied"
    await expect(landscape.getByText(words, { exact: true })).toBeVisible({ timeout: RETRIED_MS })
    // The trend's dot carries the tone: a refused profile's warning, not an outage's danger.
    await expect(
      landscape.locator("[data-slot='kpi-trend']", { hasText: words }).locator("[data-tone]"),
    ).toHaveAttribute("data-tone", "warning")
    await expect(landscape.getByText(/unreachable/)).toHaveCount(0)
    const table = app.getByRole("region", { name: "Load and job backlog per engine" })
    await expect(table.getByText("credentials rejected", { exact: true })).toBeVisible()
    // Inline the table shows three of its four engines: the fourth is one click away.
    await table.getByRole("button", { name: "Show more" }).click()
    await expect(table.getByText("access denied", { exact: true })).toBeVisible()
    // The notes on the engines it could not read never say they did not answer.
    const note = landscape.getByText(/^No columns for .+: their rows above say why\.$/)
    await expect(note).toBeVisible()
    for (const engine of [REFUSED_ENGINE, LOGIN_REFUSED_ENGINE, ACCESS_DENIED_ENGINE]) {
      await expect(note).toContainText(engine)
    }
    await expect(landscape.getByText(/answer/)).toHaveCount(0)
  })

  test("opening it names the status the row words", async ({ page }) => {
    const app = await openCockpit(page)
    await rowOf(app, LOGIN_REFUSED_ENGINE).click({ timeout: 15_000 })
    await expect(
      app
        .getByText(`Engine ${LOGIN_REFUSED_ENGINE} rejected the server's credentials (HTTP 401)`)
        .first(),
    ).toBeVisible({ timeout: RETRIED_MS })
  })

  test("opening the engine that answers 403 names the denied access", async ({ page }) => {
    const app = await openCockpit(page)
    await rowOf(app, ACCESS_DENIED_ENGINE).click({ timeout: 15_000 })
    await expect(
      app.getByText(`Engine ${ACCESS_DENIED_ENGINE} denied access (HTTP 403)`).first(),
    ).toBeVisible({ timeout: RETRIED_MS })
  })
})
